import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database";
import { cars, maintenanceReminders, pushSubscriptions, settings } from "@/lib/schema";
import { completeMaintenance, getMaintenance, linkScheduleToService, MaintenanceError, saveMaintenance, type MaintenanceInput } from "@/lib/maintenance";
import { getService, receiptsFor, saveService } from "@/lib/services";
import {
  deliver, isPushEndpoint, pendingReminder, reminderMessage, removeSubscription, runReminderCheck, saveSubscription,
  subscriptionsFor, type PushMessage, type PushSender, type PushSubscriptionRow,
} from "@/lib/push";

process.env.TZ_NAME = "America/Chicago";
const DAY = 24 * 60 * 60 * 1000;
/** 10 AM in Chicago (CDT) on Oct 26, 2026. */
const MORNING = Date.UTC(2026, 9, 26, 15);
const APPLE = "https://web.push.apple.com/synthetic-test-endpoint";
const connections: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const { sqlite } of connections.splice(0)) sqlite.close(); });

function fresh() {
  const connection = openDatabase(":memory:"); connections.push(connection);
  const { db } = connection;
  db.insert(cars).values({ id: 1, nickname: "Test truck", createdAt: MORNING, updatedAt: MORNING }).run();
  db.insert(cars).values({ id: 2, nickname: "Mazda", createdAt: MORNING, updatedAt: MORNING }).run();
  return db;
}
type Db = ReturnType<typeof fresh>;
const schedule = (db: Db, changes: Partial<MaintenanceInput> = {}, carId = 1) => saveMaintenance(db, carId, {
  title: "Oil and filter", intervalMiles: null, intervalMonths: 12, baselineDate: "2025-06-03", baselineMiles: null,
  lastServiceId: null, enabled: true, notes: null, ...changes,
}, { requestKey: randomUUID(), now: MORNING });
const work = (changes: Partial<Parameters<typeof saveService>[2]> = {}) => ({
  kind: "service" as const, title: "Oil and filter", date: "2026-10-26", shop: "DIY", miles: 191900, totalCents: 3500, lineItems: [], notes: null, ...changes,
});
const device = (db: Db, endpoint = APPLE) => saveSubscription(db, 1, { endpoint, p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "AAAAAAAAAAAAAAAAAAAAAA", label: "iPhone" }, MORNING);
function recorder(fail?: (row: PushSubscriptionRow) => number | null) {
  const sent: { endpoint: string; message: PushMessage }[] = [];
  const send: PushSender = async (row, message) => {
    const status = fail?.(row);
    if (status) throw Object.assign(new Error("refused"), { statusCode: status });
    sent.push({ endpoint: row.endpoint, message });
  };
  return { sent, send };
}

describe("push subscriptions", () => {
  it("accepts only real push services over HTTPS", () => {
    expect(isPushEndpoint(APPLE)).toBe(true);
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushEndpoint("http://web.push.apple.com/x")).toBe(false);
    expect(isPushEndpoint("https://evil.example/web.push.apple.com")).toBe(false);
    expect(isPushEndpoint("https://push.apple.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("http://127.0.0.1:8080/api")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
    expect(() => device(fresh(), "https://internal.example/hook")).toThrow(/isn't supported/);
  });
  it("saves one row per device, updating keys on re-subscribe, and removes it", () => {
    const db = fresh();
    device(db);
    saveSubscription(db, 1, { endpoint: APPLE, p256dh: "newkeynewkeynewkey", auth: "newauthnewauth12", label: "iPhone" }, MORNING);
    expect(subscriptionsFor(db)).toHaveLength(1);
    expect(subscriptionsFor(db)[0]).toMatchObject({ p256dh: "newkeynewkeynewkey", auth: "newauthnewauth12" });
    expect(removeSubscription(db, APPLE)).toBe(true);
    expect(subscriptionsFor(db)).toHaveLength(0);
  });
  it("records delivery, forgets devices the push service says are gone, and keeps others with the error", async () => {
    const db = fresh();
    device(db, APPLE); device(db, "https://fcm.googleapis.com/fcm/send/gone"); device(db, "https://fcm.googleapis.com/fcm/send/flaky");
    const { sent, send } = recorder((row) => row.endpoint.endsWith("gone") ? 410 : row.endpoint.endsWith("flaky") ? 503 : null);
    const result = await deliver(db, subscriptionsFor(db), { title: "t", body: "b", url: "/maintenance", tag: "x" }, send, MORNING);
    expect(result).toEqual({ delivered: 1, failed: 1 });
    expect(sent.map((s) => s.endpoint)).toEqual([APPLE]);
    const rows = subscriptionsFor(db);
    expect(rows.map((r) => r.endpoint).sort()).toEqual([APPLE, "https://fcm.googleapis.com/fcm/send/flaky"].sort());
    expect(rows.find((r) => r.endpoint === APPLE)).toMatchObject({ lastSuccessAt: MORNING, lastError: null });
    expect(rows.find((r) => r.endpoint.endsWith("flaky"))).toMatchObject({ lastFailureAt: MORNING, lastError: "Push service answered 503" });
  });
});

describe("daily reminder check", () => {
  it("waits until 9 AM household time and needs signing keys", async () => {
    const db = fresh(); schedule(db); device(db);
    const { sent, send } = recorder();
    expect(await runReminderCheck(db, send, Date.UTC(2026, 9, 26, 13, 59))).toMatchObject({ sent: false, reason: "not-time" });
    expect(await runReminderCheck(db, null, MORNING)).toMatchObject({ sent: false, reason: "not-time" });
    expect(sent).toHaveLength(0);
  });
  it("sends one notification listing due items by car, then repeats weekly until done", async () => {
    const db = fresh();
    schedule(db); // Test truck oil: overdue since 2026-06-03
    schedule(db, { title: "Replace cabin air filter", baselineDate: "2025-11-10" }); // due 2026-11-10: due soon
    schedule(db, { title: "Rotate tires", intervalMonths: 6, baselineDate: "2026-02-01" }, 2); // Mazda: overdue
    schedule(db, { title: "Coolant", intervalMonths: 120, baselineDate: "2022-02-23" }, 2); // upcoming: not listed
    device(db);
    const { sent, send } = recorder();
    expect(await runReminderCheck(db, send, MORNING)).toMatchObject({ sent: true, items: 3, delivered: 1 });
    expect(sent[0].message).toEqual({
      title: "2 maintenance items are due now",
      body: "Test truck: Oil and filter (due now); Replace cabin air filter (due soon)\nMazda: Rotate tires (due now)",
      url: "/maintenance", tag: "maintenance-reminder",
    });
    expect(await runReminderCheck(db, send, MORNING + 3 * 60 * 60 * 1000)).toMatchObject({ reason: "not-time" });
    for (let day = 1; day < 7; day++) expect(await runReminderCheck(db, send, MORNING + day * DAY)).toMatchObject({ sent: false, reason: "nothing-owed" });
    expect(await runReminderCheck(db, send, MORNING + 7 * DAY)).toMatchObject({ sent: true, items: 3 });
    expect(sent).toHaveLength(2);
  });
  it("sends right away when something new comes due, and stops for items marked done", async () => {
    const db = fresh();
    const oil = schedule(db);
    schedule(db, { title: "Replace cabin air filter", baselineDate: "2025-11-30" }); // due 2026-11-30
    device(db);
    const { sent, send } = recorder();
    await runReminderCheck(db, send, MORNING);
    expect(sent[0].message.body).toBe("Test truck: Oil and filter (due now)");
    // Five days later the cabin filter enters its 30-day due-soon window: a reminder goes out that day.
    await runReminderCheck(db, send, MORNING + DAY);
    await runReminderCheck(db, send, MORNING + 5 * DAY);
    expect(sent).toHaveLength(2);
    expect(sent[1].message.body).toBe("Test truck: Oil and filter (due now); Replace cabin air filter (due soon)");
    completeMaintenance(db, 1, oil.id, oil.revision, work({ date: "2026-10-31" }), { requestKey: randomUUID(), now: MORNING + 5 * DAY });
    expect(pendingReminder(db, MORNING + 12 * DAY).due.map((d) => d.due.schedule.title)).toEqual(["Replace cabin air filter"]);
    await runReminderCheck(db, send, MORNING + 12 * DAY);
    expect(sent[2].message).toMatchObject({ title: "Maintenance due soon", body: "Test truck: Replace cabin air filter (due soon)" });
    expect(db.select().from(maintenanceReminders).all().map((r) => r.scheduleId)).not.toContain(oil.id);
  });
  it("retries a failed send on the next hourly run and doesn't count it as reminded", async () => {
    const db = fresh(); schedule(db); device(db);
    let down = true;
    const { sent, send } = recorder(() => down ? 503 : null);
    expect(await runReminderCheck(db, send, MORNING)).toMatchObject({ sent: false, reason: "failed" });
    expect(db.select().from(maintenanceReminders).all()).toHaveLength(0);
    down = false;
    expect(await runReminderCheck(db, send, MORNING + 60 * 60 * 1000)).toMatchObject({ sent: true });
    expect(sent).toHaveLength(1);
  });
  it("retries only the device that missed today's reminder, then stops for the day", async () => {
    const db = fresh(); schedule(db);
    device(db, APPLE); device(db, "https://fcm.googleapis.com/fcm/send/second-phone");
    let secondDown = true;
    const { sent, send } = recorder((row) => secondDown && row.endpoint.endsWith("second-phone") ? 503 : null);
    expect(await runReminderCheck(db, send, MORNING)).toMatchObject({ sent: true, delivered: 1, failed: 1 });
    expect(await runReminderCheck(db, send, MORNING + 60 * 60 * 1000)).toMatchObject({ reason: "failed" });
    secondDown = false;
    expect(await runReminderCheck(db, send, MORNING + 2 * 60 * 60 * 1000)).toMatchObject({ sent: true, delivered: 1, failed: 0 });
    expect(sent.map((s) => s.endpoint)).toEqual([APPLE, "https://fcm.googleapis.com/fcm/send/second-phone"]);
    expect(await runReminderCheck(db, send, MORNING + 3 * 60 * 60 * 1000)).toMatchObject({ reason: "not-time" });
    expect(await runReminderCheck(db, send, MORNING + DAY)).toMatchObject({ reason: "nothing-owed" });
    expect(sent).toHaveLength(2);
  });
  it("doesn't retry a device that fails permanently, but notes the error", async () => {
    const db = fresh(); schedule(db);
    device(db, APPLE); device(db, "https://fcm.googleapis.com/fcm/send/old-keys");
    const { sent, send } = recorder((row) => row.endpoint.endsWith("old-keys") ? 403 : null);
    expect(await runReminderCheck(db, send, MORNING)).toMatchObject({ sent: true, delivered: 1, failed: 0 });
    expect(await runReminderCheck(db, send, MORNING + 60 * 60 * 1000)).toMatchObject({ reason: "not-time" });
    expect(sent).toHaveLength(1);
    expect(subscriptionsFor(db).find((r) => r.endpoint.endsWith("old-keys"))).toMatchObject({ lastError: "Push service answered 403" });
  });
  it("without devices, notes the day and sends nothing; disabled schedules are never listed", async () => {
    const db = fresh(); schedule(db, { enabled: false });
    const { send } = recorder();
    expect(await runReminderCheck(db, send, MORNING)).toMatchObject({ reason: "nothing-owed" });
    schedule(db, { title: "Rotate tires" });
    expect(await runReminderCheck(db, send, MORNING + DAY)).toMatchObject({ reason: "no-devices" });
    expect(db.select().from(settings).all()).toContainEqual({ key: "reminders_last_check_day", value: "2026-10-27" });
    expect(db.select().from(pushSubscriptions).all()).toHaveLength(0);
  });
  it("shortens very long reminder text", () => {
    const db = fresh();
    for (let i = 0; i < 40; i++) schedule(db, { title: `Very long maintenance item number ${i} with extra words` });
    const message = reminderMessage(pendingReminder(db, MORNING).due);
    expect(message.body.length).toBeLessThanOrEqual(600);
    expect(message.body.endsWith("...")).toBe(true);
  });
});

describe("marking maintenance done", () => {
  it("saves the work and restarts the schedule from it, and a repeated submit changes nothing", () => {
    const db = fresh(); const oil = schedule(db);
    const key = randomUUID();
    const first = completeMaintenance(db, 1, oil.id, oil.revision, work(), { requestKey: key, createdBy: 1, now: MORNING });
    expect(first.schedule).toMatchObject({ lastServiceId: first.service.id, baselineDate: null, baselineMiles: null, revision: 2 });
    expect(getService(db, 1, first.service.id)).toMatchObject({ title: "Oil and filter", date: "2026-10-26", miles: 191900, totalCents: 3500 });
    const again = completeMaintenance(db, 1, oil.id, oil.revision, work(), { requestKey: key, createdBy: 1, now: MORNING });
    expect(again.service.id).toBe(first.service.id);
    expect(getMaintenance(db, 1, oil.id)?.revision).toBe(2);
  });
  it("refuses stale, older, quoted or other-car work without saving anything", () => {
    const db = fresh(); const oil = schedule(db);
    const stale = () => completeMaintenance(db, 1, oil.id, oil.revision + 5, work(), { requestKey: randomUUID(), now: MORNING });
    expect(stale).toThrow(MaintenanceError);
    expect(() => completeMaintenance(db, 1, oil.id, oil.revision, work({ date: "2025-01-01" }), { requestKey: randomUUID(), now: MORNING })).toThrow(/already counts from work on/);
    expect(() => completeMaintenance(db, 1, oil.id, oil.revision, work({ kind: "quote" }), { requestKey: randomUUID(), now: MORNING })).toThrow(MaintenanceError);
    const otherCar = saveService(db, 2, work({ miles: 50000 }), { requestKey: randomUUID(), now: MORNING });
    expect(() => linkScheduleToService(db, 1, oil.id, otherCar.id, { now: MORNING })).toThrow(/Only completed service for this car/);
    expect(db.select().from(cars).all()).toHaveLength(2);
    expect(getMaintenance(db, 1, oil.id)).toMatchObject({ revision: 1, lastServiceId: null, baselineDate: "2025-06-03" });
    expect(connections.at(-1)!.sqlite.prepare("select count(*) n from service_records where car_id = 1").get()).toEqual({ n: 0 });
  });
  it("attaches photos and receipts with the work, once, and saves nothing when a file is refused", () => {
    const db = fresh(); const oil = schedule(db);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const pdf = Buffer.from("%PDF-1.4 synthetic receipt");
    const files = [{ name: "dipstick.jpg", bytes: jpeg }, { name: "receipt.pdf", bytes: pdf }];
    const bad = () => completeMaintenance(db, 1, oil.id, oil.revision, work(), { requestKey: randomUUID(), now: MORNING, files: [...files, { name: "notes.txt", bytes: Buffer.from("plain text") }] });
    expect(bad).toThrow(/notes\.txt: Use a PDF, JPEG/);
    expect(getMaintenance(db, 1, oil.id)).toMatchObject({ revision: 1, lastServiceId: null });
    const key = randomUUID();
    const done = completeMaintenance(db, 1, oil.id, oil.revision, work({ notes: "Pads at 4 mm" }), { requestKey: key, now: MORNING, files });
    expect(receiptsFor(db, done.service.id).map((r) => [r.name, r.mime])).toEqual(expect.arrayContaining([["dipstick.jpg", "image/jpeg"], ["receipt.pdf", "application/pdf"]]));
    completeMaintenance(db, 1, oil.id, oil.revision, work({ notes: "Pads at 4 mm" }), { requestKey: key, now: MORNING, files });
    expect(receiptsFor(db, done.service.id)).toHaveLength(2);
    expect(getService(db, 1, done.service.id)?.notes).toBe("Pads at 4 mm");
  });
  it("leaves optional work out of reminders", () => {
    const db = fresh();
    schedule(db);
    schedule(db, { title: "Transmission fluid", optional: true });
    expect(pendingReminder(db, MORNING).due.map((d) => d.due.schedule.title)).toEqual(["Oil and filter"]);
  });
});

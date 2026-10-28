import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "./database";
import { cars } from "@/lib/schema";
import { getMaintenance, saveMaintenance, type MaintenanceInput } from "@/lib/maintenance";
import { getService, saveService } from "@/lib/services";
import { subscriptionsFor } from "@/lib/push";
import { addReading } from "@/lib/cars";

const auth = vi.hoisted(() => ({ signedIn: true }));
const push = vi.hoisted(() => ({ send: vi.fn(async () => undefined) }));
vi.mock("@/lib/session", () => ({ requireUser: async () => {
  if (!auth.signedIn) throw new Error("SIGN_IN_REQUIRED");
  return { id: 1, name: "Owner" };
} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
  unstable_rethrow: (error: unknown) => { if (error instanceof Error && /^(?:REDIRECT:|NOT_FOUND)/.test(error.message)) throw error; },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification: push.send } }));
vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  return { ...real, getDatabase: () => connection.db, getConnection: () => connection };
});
import { completeMaintenanceAction } from "@/app/maintenance-actions";
import { saveServiceAction } from "@/app/service-actions";
import { disableReminders, enableReminders, sendTestReminder } from "@/app/push-actions";
import MaintenanceDetailPage from "@/app/(garage)/cars/[id]/maintenance/[maintenanceId]/page";
import NewServicePage from "@/app/(garage)/cars/[id]/services/new/page";
import SettingsPage from "@/app/(garage)/settings/page";

process.env.TZ_NAME = "America/Chicago";
let connection: ReturnType<typeof openDatabase>;
const NOW = Date.now();
const APPLE = "https://web.push.apple.com/synthetic-test-endpoint";
const subscription = { endpoint: APPLE, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "AAAAAAAAAAAAAAAAAAAAAA" } };
const schedule = (changes: Partial<MaintenanceInput> = {}, carId = 1) => saveMaintenance(connection.db, carId, {
  title: "Oil and filter", intervalMiles: null, intervalMonths: 12, baselineDate: "2025-06-03", baselineMiles: null, lastServiceId: null, enabled: true, notes: null, ...changes,
}, { requestKey: randomUUID(), now: NOW });
const fields = (values: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

beforeEach(() => {
  vi.stubGlobal("React", React);
  connection = openDatabase(":memory:"); auth.signedIn = true;
  connection.db.insert(cars).values({ id: 1, nickname: "Test truck", createdAt: NOW, updatedAt: NOW }).run();
  connection.db.insert(cars).values({ id: 2, nickname: "Mazda", createdAt: NOW, updatedAt: NOW }).run();
  process.env.VAPID_PUBLIC_KEY = "BPublicKeyForTestsOnly"; process.env.VAPID_PRIVATE_KEY = "privateKeyForTestsOnly";
});
afterEach(() => { connection.sqlite.close(); vi.unstubAllGlobals(); vi.clearAllMocks(); delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; });

describe("mark done action", () => {
  it("requires sign-in", async () => {
    const oil = schedule(); auth.signedIn = false;
    await expect(completeMaintenanceAction(1, oil.id, oil.revision, {}, fields({ requestKey: randomUUID(), date: today() }))).rejects.toThrow("SIGN_IN_REQUIRED");
  });
  it("saves the work, restarts the schedule and shows the confirmation", async () => {
    const oil = schedule();
    await expect(completeMaintenanceAction(1, oil.id, oil.revision, {}, fields({ requestKey: randomUUID(), date: today(), miles: "191,950", shop: "DIY", totalCents: "36.10", notes: "Mobil 1" })))
      .rejects.toThrow(new RegExp(`REDIRECT:/cars/1/services/\\d+\\?done=${oil.id}$`));
    const updated = getMaintenance(connection.db, 1, oil.id)!;
    expect(getService(connection.db, 1, updated.lastServiceId!)).toMatchObject({ title: "Oil and filter", miles: 191950, totalCents: 3610, shop: "DIY", notes: "Mobil 1" });
    const html = renderToStaticMarkup(await MaintenanceDetailPage({ params: Promise.resolve({ id: "1", maintenanceId: String(oil.id) }), searchParams: Promise.resolve({ done: "1" }) }));
    expect(html).toContain("Marked done.");
    expect(html).toContain("View last completed service");
  });
  it("returns field errors without saving", async () => {
    const oil = schedule();
    const state = await completeMaintenanceAction(1, oil.id, oil.revision, {}, fields({ requestKey: randomUUID(), date: "2999-01-01", miles: "lots" }));
    expect(state.errors).toMatchObject({ date: expect.any(String), miles: expect.any(String) });
    expect(getMaintenance(connection.db, 1, oil.id)?.revision).toBe(1);
    expect(await completeMaintenanceAction(1, 999, 1, {}, fields({ requestKey: randomUUID(), date: today() }))).toMatchObject({ stale: true });
  });
  it("offers Mark done, filling in mileage only from a reading taken today", async () => {
    const oil = schedule();
    const page = async () => renderToStaticMarkup(await MaintenanceDetailPage({ params: Promise.resolve({ id: "1", maintenanceId: String(oil.id) }) }));
    saveService(connection.db, 1, { kind: "service", title: "Earlier", date: "2025-06-03", shop: null, miles: 184260, totalCents: null, lineItems: [], notes: null }, { requestKey: randomUUID(), now: NOW });
    saveService(connection.db, 1, { kind: "service", title: "Later", date: "2026-01-03", shop: null, miles: 187000, totalCents: null, lineItems: [], notes: null }, { requestKey: randomUUID(), now: NOW });
    let html = await page();
    expect(html).toContain("Mark done");
    expect(html).toMatch(/id="done-miles"[^>]*value=""/);
    expect(html).toContain("Garage estimates about");
    addReading(connection.db, { carId: 1, miles: 191950, readAt: Date.now(), source: "manual" });
    html = await page();
    expect(html).toMatch(/id="done-miles"[^>]*value="191950"/);
    expect(html).toContain("today&#x27;s odometer reading");
  });
});

describe("new service that completes maintenance", () => {
  it("lists the car's schedules, due first, and links ticked ones to the new record", async () => {
    const oil = schedule();
    const coolant = schedule({ title: "Coolant", intervalMonths: 60, baselineDate: "2023-08-02" });
    schedule({ title: "Rotate tires" }, 2);
    const html = renderToStaticMarkup(await NewServicePage({ params: Promise.resolve({ id: "1" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("This work completes");
    expect(html.indexOf("Oil and filter")).toBeLessThan(html.indexOf("Coolant"));
    expect(html).not.toContain("Rotate tires");
    await expect(saveServiceAction(1, null, {}, fields({ requestKey: randomUUID(), kind: "service", title: "DIY oil change", date: today(), shop: "DIY", miles: "", totalCents: "", notes: "",
      itemDescription: [""], itemCost: [""], completes: [String(oil.id)] }))).rejects.toThrow(/REDIRECT:\/cars\/1\/services\/\d+/);
    const record = connection.sqlite.prepare("select id from service_records where title = 'DIY oil change'").get() as { id: number };
    expect(getMaintenance(connection.db, 1, oil.id)?.lastServiceId).toBe(record.id);
    expect(getMaintenance(connection.db, 1, coolant.id)?.lastServiceId).toBeNull();
  });
  it("saves nothing when a ticked schedule can't be completed by this work", async () => {
    const oil = schedule({ baselineDate: today() });
    const state = await saveServiceAction(1, null, {}, fields({ requestKey: randomUUID(), kind: "service", title: "Old work", date: "2024-01-01", shop: "", miles: "", totalCents: "", notes: "",
      itemDescription: [""], itemCost: [""], completes: [String(oil.id)] }));
    expect(state.errors?.completes).toMatch(/already counts from work on/);
    expect(connection.sqlite.prepare("select count(*) n from service_records").get()).toEqual({ n: 0 });
  });
});

describe("reminder settings", () => {
  it("turns reminders on for a device, sends a test, and turns them off", async () => {
    expect(await enableReminders(subscription, "iPhone")).toMatchObject({ ok: true });
    expect(subscriptionsFor(connection.db)).toMatchObject([{ endpoint: APPLE, label: "iPhone", userId: 1 }]);
    expect(await sendTestReminder(APPLE)).toMatchObject({ ok: true });
    expect(push.send).toHaveBeenCalledOnce();
    expect(JSON.parse((push.send.mock.calls[0] as unknown[])[1] as string)).toMatchObject({ title: "Household Garage", url: "/maintenance" });
    const html = renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Reminders");
    expect(html).toContain("iPhone");
    expect(await disableReminders(APPLE)).toMatchObject({ ok: true });
    expect(subscriptionsFor(connection.db)).toHaveLength(0);
  });
  it("refuses non-push endpoints, unknown devices and a server without keys", async () => {
    expect(await enableReminders({ ...subscription, endpoint: "https://example.com/hook" }, "x")).toMatchObject({ ok: false });
    expect(await enableReminders({ endpoint: APPLE }, "x")).toMatchObject({ ok: false });
    expect(await sendTestReminder("https://web.push.apple.com/unknown")).toMatchObject({ ok: false });
    expect(subscriptionsFor(connection.db)).toHaveLength(0);
    delete process.env.VAPID_PUBLIC_KEY;
    expect(await enableReminders(subscription, "iPhone")).toMatchObject({ ok: false, message: expect.stringMatching(/aren't set up/) });
    const html = renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("set up on the server yet");
  });
  it("requires sign-in for every reminder action", async () => {
    auth.signedIn = false;
    await expect(enableReminders(subscription, "iPhone")).rejects.toThrow("SIGN_IN_REQUIRED");
    await expect(disableReminders(APPLE)).rejects.toThrow("SIGN_IN_REQUIRED");
    await expect(sendTestReminder(APPLE)).rejects.toThrow("SIGN_IN_REQUIRED");
  });
});

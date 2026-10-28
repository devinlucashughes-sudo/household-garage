import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import type { AppDatabase, QueryDatabase } from "./db";
import { pushSettings } from "./config";
import { dateInputValue } from "./format";
import { householdMaintenanceDue, type HouseholdMaintenanceDue, type MaintenanceSchedule } from "./maintenance";
import { maintenanceStateLabel } from "./maintenance-input";
import { maintenanceReminders, pushSubscriptions, settings } from "./schema";

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type PushMessage = { title: string; body: string; url: string; tag: string };
/** Delivers one message to one device. Throws with `statusCode` when the push service refuses it. */
export type PushSender = (subscription: PushSubscriptionRow, message: PushMessage) => Promise<void>;

export const REMINDER_HOUR = 9;
export const REMINDER_EVERY_DAYS = 7;
const LAST_CHECK_KEY = "reminders_last_check_day";
const SENT_KEY = "reminders_sent_day";

/** Push services the server will deliver to. Anything else is refused so the server can't be pointed elsewhere. */
const PUSH_HOSTS = ["push.apple.com", "fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "notify.windows.com"];
export function isPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

export function saveSubscription(db: AppDatabase, userId: number, value: { endpoint: string; p256dh: string; auth: string; label: string }, now = Date.now()) {
  if (!isPushEndpoint(value.endpoint)) throw new Error("That browser's push service isn't supported.");
  return db.insert(pushSubscriptions).values({ userId, ...value, createdAt: now })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: value.p256dh, auth: value.auth, label: value.label, lastError: null } })
    .returning().get();
}

export const removeSubscription = (db: QueryDatabase, endpoint: string) =>
  db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run().changes > 0;
export const subscriptionsFor = (db: QueryDatabase) => db.select().from(pushSubscriptions).all();
export const getSubscription = (db: QueryDatabase, endpoint: string) =>
  db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).get() ?? null;

/** The real sender, signing with the server's VAPID keys. */
export function webPushSender(): PushSender | null {
  const keys = pushSettings();
  if (!keys) return null;
  return async (subscription, message) => {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(message),
      { vapidDetails: keys, TTL: 24 * 60 * 60, urgency: "normal", timeout: 20_000 },
    );
  };
}

/**
 * Send to each device; forget devices the push service says are gone. `remindedDay` marks devices that
 * received the daily reminder. Returns how many received it and how many failed temporarily (worth retrying).
 */
export async function deliver(db: QueryDatabase, devices: PushSubscriptionRow[], message: PushMessage, send: PushSender,
  now = Date.now(), remindedDay?: string) {
  let delivered = 0, failed = 0;
  for (const device of devices) {
    try {
      await send(device, message);
      delivered++;
      db.update(pushSubscriptions).set({ lastSuccessAt: now, lastError: null, ...(remindedDay ? { lastRemindedDay: remindedDay } : {}) })
        .where(eq(pushSubscriptions.id, device.id)).run();
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) { removeSubscription(db, device.endpoint); continue; }
      // Only temporary problems are worth retrying today; others (such as a key mismatch) wait for tomorrow.
      if (status === undefined || status === 429 || status >= 500) failed++;
      const text = (status ? `Push service answered ${status}` : error instanceof Error ? error.message : "Unknown error").slice(0, 300);
      db.update(pushSubscriptions).set({ lastFailureAt: now, lastError: text }).where(eq(pushSubscriptions.id, device.id)).run();
    }
  }
  return { delivered, failed };
}

/** A schedule's baseline and intervals. When it changes (for example, marked done), its reminders start over. */
export const reminderCycle = (schedule: MaintenanceSchedule) =>
  JSON.stringify([schedule.lastServiceId, schedule.baselineDate, schedule.baselineMiles, schedule.intervalMiles, schedule.intervalMonths]);

const dayNumber = (day: string) => Date.parse(`${day}T12:00:00Z`) / 86_400_000;

/**
 * What a reminder would say now. Everything due soon or overdue is listed; a reminder is only owed when
 * at least one of those items is new to reminders or was last included at least a week ago.
 */
export function pendingReminder(db: QueryDatabase, now = Date.now()) {
  const due = householdMaintenanceDue(db, now).filter(({ due: d }) => !d.schedule.optional && (d.state === "overdue" || d.state === "due-soon"));
  const previous = new Map(db.select().from(maintenanceReminders).all().map((row) => [row.scheduleId, row]));
  const today = dayNumber(dateInputValue(now));
  const owed = due.some(({ due: d }) => {
    const row = previous.get(d.schedule.id);
    return !row || row.cycle !== reminderCycle(d.schedule) || today - dayNumber(dateInputValue(row.lastSentAt)) >= REMINDER_EVERY_DAYS;
  });
  return { due, owed, message: due.length ? reminderMessage(due) : null };
}

export function reminderMessage(due: HouseholdMaintenanceDue[]): PushMessage {
  const byCar = new Map<string, string[]>();
  for (const { carName, due: d } of due) byCar.set(carName, [...(byCar.get(carName) ?? []), `${d.schedule.title} (${maintenanceStateLabel(d.state).toLowerCase()})`]);
  const overdue = due.filter(({ due: d }) => d.state === "overdue").length;
  const title = overdue ? `${overdue} maintenance ${overdue === 1 ? "item is" : "items are"} due now` : "Maintenance due soon";
  const body = [...byCar].map(([car, items]) => `${car}: ${items.join("; ")}`).join("\n");
  return { title, body: body.length > 600 ? `${body.slice(0, 597)}...` : body, url: "/maintenance", tag: "maintenance-reminder" };
}

/** Record that these schedules were just included in a reminder, and forget schedules no longer due. */
export function markReminded(db: AppDatabase, due: HouseholdMaintenanceDue[], now = Date.now()) {
  db.transaction((tx) => {
    const ids = due.map(({ due: d }) => d.schedule.id);
    const stale = tx.select({ id: maintenanceReminders.scheduleId }).from(maintenanceReminders).all().map((r) => r.id).filter((id) => !ids.includes(id));
    if (stale.length) tx.delete(maintenanceReminders).where(inArray(maintenanceReminders.scheduleId, stale)).run();
    for (const { due: d } of due) tx.insert(maintenanceReminders).values({ scheduleId: d.schedule.id, cycle: reminderCycle(d.schedule), lastSentAt: now })
      .onConflictDoUpdate({ target: maintenanceReminders.scheduleId, set: { cycle: reminderCycle(d.schedule), lastSentAt: now } }).run();
  });
}

const localHour = (now: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: process.env.TZ_NAME || "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(now));

const readSetting = (db: QueryDatabase, key: string) => db.select().from(settings).where(eq(settings.key, key)).get()?.value;
const writeSetting = (db: QueryDatabase, key: string, value: string) =>
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();

/**
 * The daily reminder check, run hourly by the server. Once a day after 9 AM household time it sends one
 * notification listing everything due soon or due now, when anything is newly due or a week has passed.
 * Devices that didn't receive today's reminder because of a temporary failure are retried alone on the
 * next hourly runs that day.
 */
export async function runReminderCheck(db: AppDatabase, send: PushSender | null, now = Date.now()) {
  const today = dateInputValue(now);
  if (!send || readSetting(db, LAST_CHECK_KEY) === today || localHour(now) < REMINDER_HOUR) return { sent: false, reason: "not-time" as const };
  const done = () => writeSetting(db, LAST_CHECK_KEY, today);
  const retrying = readSetting(db, SENT_KEY) === today;
  const pending = pendingReminder(db, now);
  if (!pending.message || (!retrying && !pending.owed)) {
    if (!pending.due.length) markReminded(db, [], now);
    done(); return { sent: false, reason: "nothing-owed" as const };
  }
  const targets = subscriptionsFor(db).filter((device) => !retrying || device.lastRemindedDay !== today);
  if (!targets.length) { done(); return { sent: false, reason: retrying ? "nothing-owed" as const : "no-devices" as const }; }
  const { delivered, failed } = await deliver(db, targets, pending.message, send, now, today);
  if (delivered && !retrying) { markReminded(db, pending.due, now); writeSetting(db, SENT_KEY, today); }
  if (!failed) done();
  if (!delivered) return { sent: false, reason: "failed" as const, failed };
  return { sent: true, reason: "sent" as const, items: pending.due.length, delivered, failed };
}

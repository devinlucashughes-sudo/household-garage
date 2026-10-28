"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDatabase } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { deliver, getSubscription, isPushEndpoint, removeSubscription, saveSubscription, webPushSender } from "@/lib/push";

export type ReminderResult = { ok: boolean; message: string };

const key = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).min(16).max(200);
const subscription = z.object({
  endpoint: z.string().url().max(2000).refine(isPushEndpoint, "That browser's push service isn't supported."),
  keys: z.object({ p256dh: key, auth: key }),
});
const label = z.string().trim().min(1).max(60).catch("This device");

export async function enableReminders(value: unknown, deviceLabel: unknown): Promise<ReminderResult> {
  const user = await requireUser();
  const parsed = subscription.safeParse(value);
  if (!parsed.success) return { ok: false, message: "This browser's reminder sign-up wasn't accepted. Try again, or use the Home Screen app." };
  if (!webPushSender()) return { ok: false, message: "Reminders aren't set up on the server yet." };
  saveSubscription(getDatabase(), user.id, { endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, label: label.parse(deviceLabel) });
  revalidatePath("/settings");
  return { ok: true, message: "Reminders are on for this device." };
}

export async function disableReminders(endpoint: unknown): Promise<ReminderResult> {
  await requireUser();
  if (typeof endpoint === "string") removeSubscription(getDatabase(), endpoint);
  revalidatePath("/settings");
  return { ok: true, message: "Reminders are off for this device." };
}

export async function sendTestReminder(endpoint: unknown): Promise<ReminderResult> {
  await requireUser();
  const send = webPushSender();
  if (!send) return { ok: false, message: "Reminders aren't set up on the server yet." };
  const db = getDatabase();
  const device = typeof endpoint === "string" ? getSubscription(db, endpoint) : null;
  if (!device) return { ok: false, message: "This device isn't signed up for reminders. Turn them on first." };
  const { delivered } = await deliver(db, [device], { title: "Household Garage", body: "Test reminder: notifications are working on this device.", url: "/maintenance", tag: "test-reminder" }, send);
  revalidatePath("/settings");
  return delivered ? { ok: true, message: "Test sent. It should arrive in a few seconds." } : { ok: false, message: "The test didn't go through. Turn reminders off and on again on this device." };
}

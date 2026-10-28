"use client";

import { useEffect, useState, useTransition } from "react";
import { disableReminders, enableReminders, sendTestReminder, type ReminderResult } from "@/app/push-actions";

type Status = "checking" | "unsupported" | "install" | "blocked" | "off" | "on";

const toKey = (base64url: string) => {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};
const deviceLabel = () => {
  const agent = navigator.userAgent;
  return /iPhone/.test(agent) ? "iPhone" : /iPad/.test(agent) ? "iPad" : /Android/.test(agent) ? "Android phone" : /Mac/.test(agent) ? "Mac" : /Windows/.test(agent) ? "Windows computer" : "This device";
};
const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** True only when the browser reports the key and it differs; an unreported key is trusted. */
const otherKey = (key: ArrayBuffer | null | undefined, expected: Uint8Array) => {
  if (!key) return false;
  const bytes = new Uint8Array(key);
  return bytes.length !== expected.length || bytes.some((byte, index) => byte !== expected[index]);
};

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

export function ReminderControls({ publicKey }: { publicKey: string }) {
  const [status, setStatus] = useState<Status>("checking");
  const [result, setResult] = useState<ReminderResult | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) return setStatus(/iPhone|iPad/.test(navigator.userAgent) && !standalone() ? "install" : "unsupported");
      if (Notification.permission === "denied") return setStatus("blocked");
      const subscription = await currentSubscription();
      if (!subscription) return setStatus("off");
      // A subscription made with old server keys can never be delivered; replace it.
      if (otherKey(subscription.options?.applicationServerKey, toKey(publicKey))) {
        await disableReminders(subscription.endpoint).catch(() => undefined);
        await subscription.unsubscribe().catch(() => undefined);
        return setStatus("off");
      }
      setStatus("on");
      // Re-register with the server each visit, so a restored database still knows this device.
      try {
        const saved = await enableReminders(subscription.toJSON(), deviceLabel());
        if (!saved.ok) { setStatus("off"); setResult(saved); }
      } catch {
        setResult({ ok: false, message: "Couldn't confirm reminders with Garage just now. Reload this page to try again." });
      }
    })().catch(() => setStatus("unsupported"));
  }, [publicKey]);

  const turnOn = () => start(async () => {
    setResult(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus(permission === "denied" ? "blocked" : "off"); return; }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription()
        ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
      const saved = await enableReminders(subscription.toJSON(), deviceLabel());
      setResult(saved.ok ? null : saved);
      setStatus(saved.ok ? "on" : "off");
    } catch {
      setResult({ ok: false, message: "Reminders couldn't be turned on here. On iPhone, open Garage from the Home Screen and try again." });
    }
  });

  const turnOff = () => start(async () => {
    setResult(null);
    const subscription = await currentSubscription();
    if (subscription) { await disableReminders(subscription.endpoint); await subscription.unsubscribe().catch(() => undefined); }
    setStatus("off");
    setResult({ ok: true, message: "Reminders are off for this device." });
  });

  const test = () => start(async () => {
    const subscription = await currentSubscription();
    setResult(subscription ? await sendTestReminder(subscription.endpoint) : { ok: false, message: "Turn reminders on first." });
  });

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {status === "install" && <p className="notice"><strong>Open Garage from your Home Screen.</strong> iPhone only allows reminders in the Home Screen app.</p>}
      {status === "unsupported" && <p className="notice">This browser can&rsquo;t receive reminders. Use the Home Screen app on your phone.</p>}
      {status === "blocked" && <p className="notice notice--error">Notifications are blocked for Garage. Allow them in your phone&rsquo;s Settings, then come back.</p>}
      {status === "off" && <button type="button" className="button button--wide" disabled={pending} onClick={turnOn}>{pending ? "Turning on…" : "Turn on reminders on this device"}</button>}
      {status === "on" && <>
        <p className="notice notice--good">Reminders are on for this device.</p>
        <button type="button" className="button button--quiet button--wide" disabled={pending} onClick={test}>{pending ? "Sending…" : "Send a test reminder"}</button>
        <button type="button" className="link-button link-button--danger" disabled={pending} onClick={turnOff}>Turn off reminders on this device</button>
      </>}
      {result && <p className={`notice ${result.ok ? "notice--good" : "notice--error"}`} role="status">{result.message}</p>}
    </div>
  );
}

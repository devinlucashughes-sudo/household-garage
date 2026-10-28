const zone = () => process.env.TZ_NAME || "America/Chicago";

/** "Oct 26, 2026, 3:04 PM" in the household's time zone. */
export function formatWhen(ms: number | null | undefined) {
  if (!ms) return "never";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone(),
    dateStyle: "medium",
    timeStyle: "short",
  }).format(ms);
}

export function formatDay(ms: number) {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone(), dateStyle: "medium" }).format(ms);
}

/** "Oct 12", or "Oct 12, 2025" outside the current year. */
export function formatShortDay(ms: number, now = Date.now()) {
  const year = (t: number) =>
    new Intl.DateTimeFormat("en-US", { timeZone: zone(), year: "numeric" }).format(t);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone(),
    month: "short",
    day: "numeric",
    ...(year(ms) === year(now) ? {} : { year: "numeric" }),
  }).format(ms);
}

/** "48,210" */
export const formatMiles = (miles: number) => Math.round(miles).toLocaleString("en-US");

/** Today's date in the household's time zone, as a date input wants it: "2026-10-26". */
export function dateInputValue(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);
}

/**
 * The moment to record for a date picked in a form. Today means now; an earlier day means
 * midday UTC, which falls on that same date in American time zones.
 */
export function readingTime(date: string, now = Date.now()) {
  if (date === dateInputValue(now)) return now;
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

/** Allocate date-only readings in mileage order, reserving a millisecond per mile for backfills. */
export function datedReadingTime(date: string, miles: number, readings: readonly { miles: number; readAt: number }[], now = Date.now()) {
  let preferred = readingTime(date, now);
  const spaced = preferred - (2_000_000 - miles);
  if (dateInputValue(spaced) === date) preferred = spaced;
  let lower = -Infinity, upper = now;
  for (const reading of readings) {
    if (dateInputValue(reading.readAt) !== date) continue;
    if (reading.miles < miles) lower = Math.max(lower, reading.readAt + miles - reading.miles);
    if (reading.miles > miles) upper = Math.min(upper, reading.readAt - (reading.miles - miles));
  }
  if (lower > upper) return null;
  const at = Math.max(lower, Math.min(preferred, upper));
  return dateInputValue(at) === date ? at : null;
}

/** "Monday, Oct 27" in the household's time zone. */
export const formatWeekday = (ms = Date.now()) =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone(), weekday: "long", month: "short", day: "numeric" }).format(ms);

/** "Good morning" before noon, "Good afternoon" until 5 PM, then "Good evening", household time. */
export function greeting(ms = Date.now()) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone(), hour: "numeric", hourCycle: "h23" }).format(ms));
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** "320 KB" or "2.4 MB": file sizes people can read at a glance. */
export const formatFileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

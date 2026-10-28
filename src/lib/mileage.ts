/**
 * The Mileage Clock: an estimate of each car's mileage today, from its odometer readings.
 *
 * The rate is the average miles per day between two readings: the latest one, and the oldest
 * one from the 90 days before it. Ninety days follows how the car is driven now (a new commute,
 * a summer of road trips) while smoothing out one long weekend. The two readings must be at
 * least 7 days apart, because a short gap turns one road trip into a wild daily average. When
 * nothing in the last 90 days is far enough back, the newest reading that is gives the rate.
 *
 * The estimate never shows less than the latest reading.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WINDOW_DAYS = 90;
export const MIN_SPAN_DAYS = 7;

export type Reading = { miles: number; at: number };

export type MileageEstimate =
  | { kind: "none" }
  | {
      kind: "reading";
      /** The latest reading: what to show when there is no rate yet. */
      latest: Reading;
      miles: number;
    }
  | {
      kind: "estimate";
      latest: Reading;
      /** Estimated mileage now, rounded to whole miles, never below the latest reading. */
      miles: number;
      milesPerDay: number;
      /** The older reading the rate was averaged from. */
      from: Reading;
    };

/** Oldest first; ties keep the lower mileage first. */
export function sortReadings<T extends Reading>(readings: readonly T[]): T[] {
  return [...readings].sort((a, b) => a.at - b.at || a.miles - b.miles);
}

/** The reading the rate is averaged from, or null when there isn't one far enough back. */
export function rateAnchor(sorted: readonly Reading[], latest: Reading): Reading | null {
  const farEnough = sorted.filter((r) => r !== latest && r.at <= latest.at - MIN_SPAN_DAYS * DAY_MS);
  if (farEnough.length === 0) return null;
  const windowStart = latest.at - WINDOW_DAYS * DAY_MS;
  const inWindow = farEnough.filter((r) => r.at >= windowStart);
  return inWindow.length > 0 ? inWindow[0] : farEnough[farEnough.length - 1];
}

export function estimateMileage(readings: readonly Reading[], now: number): MileageEstimate {
  if (readings.length === 0) return { kind: "none" };
  const sorted = sortReadings(readings);
  const latest = sorted[sorted.length - 1];
  const from = rateAnchor(sorted, latest);
  if (!from) return { kind: "reading", latest, miles: latest.miles };
  const milesPerDay = Math.max(0, (latest.miles - from.miles) / ((latest.at - from.at) / DAY_MS));
  const daysSince = Math.max(0, (now - latest.at) / DAY_MS);
  const miles = Math.max(latest.miles, Math.round(latest.miles + milesPerDay * daysSince));
  return { kind: "estimate", latest, miles, milesPerDay, from };
}

/**
 * Odometers only count up, so a new reading must fit between its neighbours in time.
 * Returns a plain-words problem, or null when the reading fits.
 */
export function readingProblem(
  existing: readonly Reading[],
  reading: Reading,
  describe: (r: Reading) => string,
): string | null {
  const sorted = sortReadings(existing);
  const before = sorted.filter((r) => r.at <= reading.at).at(-1);
  const after = sorted.find((r) => r.at > reading.at);
  if (before && reading.miles < before.miles)
    return `That's less than the ${describe(before)}. Check the number, or delete the wrong reading.`;
  if (after && reading.miles > after.miles)
    return `That's more than the later ${describe(after)}. Check the number and the date.`;
  return null;
}

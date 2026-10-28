import { dateInputValue, formatMiles, formatShortDay } from "./format";
import { MIN_SPAN_DAYS, type MileageEstimate } from "./mileage";

const sameDay = (a: number, b: number) => dateInputValue(a) === dateInputValue(b);

/**
 * The Mileage Clock in words, keeping readings and estimates apart:
 * the headline number, whether it is an estimate, and the reading it rests on.
 */
export function mileageWords(estimate: MileageEstimate, now = Date.now()) {
  if (estimate.kind === "none")
    return { headline: null, isEstimate: false, basis: "No odometer reading yet." };
  const { latest } = estimate;
  const when = sameDay(latest.at, now) ? "today" : `on ${formatShortDay(latest.at, now)}`;
  const isEstimate = estimate.kind === "estimate" && estimate.miles !== latest.miles;
  return {
    headline: formatMiles(estimate.miles),
    isEstimate,
    basis: isEstimate
      ? `last reading ${formatMiles(latest.miles)} ${when}`
      : `odometer reading ${when}`,
  };
}

/** One line for lists: "est. 48,210 · last reading 47,950 on Oct 12". */
export function mileageLine(estimate: MileageEstimate, now = Date.now()) {
  const words = mileageWords(estimate, now);
  if (!words.headline) return words.basis;
  return `${words.isEstimate ? "est. " : ""}${words.headline} · ${words.basis}`;
}

/** How the estimate was worked out, or what it still needs. */
export function rateWords(estimate: MileageEstimate, now = Date.now()) {
  if (estimate.kind === "none") return "Add an odometer reading to start the Mileage Clock.";
  if (estimate.kind === "reading")
    return `Add another reading at least ${MIN_SPAN_DAYS} days after an earlier one and the app starts estimating.`;
  const perDay = estimate.milesPerDay;
  const rate = perDay >= 10 ? Math.round(perDay).toString() : perDay.toFixed(1).replace(/\.0$/, "");
  return `About ${rate} miles a day: the average from ${formatMiles(estimate.from.miles)} on ${formatShortDay(estimate.from.at, now)} to ${formatMiles(estimate.latest.miles)} on ${formatShortDay(estimate.latest.at, now)}.`;
}

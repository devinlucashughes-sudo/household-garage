import { formatMiles } from "./format";
import type { HouseholdMaintenanceDue, MaintenanceDue } from "./maintenance";
import { maintenanceDay } from "./maintenance-input";

/**
 * How one schedule reads in the maintenance ledger: what and how often on the left, the limit that
 * matters and how far past or away it is on the right. Pure, so the wording is tested once.
 */
export type LedgerTone = "due" | "soon" | "unknown" | "ok" | "off";
export type LedgerLine = { interval: string; lastDone: string | null; limit: string | null; status: string; tone: LedgerTone; days: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function intervalWords(miles: number | null, months: number | null) {
  const m = miles === null ? null : `${formatMiles(miles)} mi`;
  const t = months === null ? null : plural(months, "month");
  if (m && t) return `${m} or ${t}`;
  return `Every ${m ?? t ?? "time"}`;
}

/** "146 days", "about 5 months", "about 2 years": exact while close, rounded once it is far off. */
export function spanWords(days: number) {
  const d = Math.abs(Math.round(days));
  if (d <= 90) return plural(d, "day");
  if (d < 730) return `about ${plural(Math.round(d / 30.44), "month")}`;
  return `about ${plural(Math.round(d / 365.25), "year")}`;
}

/** Days until a limit, so mile and date limits can be compared and sorted. Unknown pace sorts last. */
function milesAsDays(miles: number, milesPerDay: number | null) {
  if (milesPerDay && milesPerDay > 0) return miles / milesPerDay;
  return miles <= 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
}

export function ledgerLine(due: MaintenanceDue, milesPerDay: number | null = null): LedgerLine {
  const { schedule } = due;
  const lastDone = due.baselineSource === "service" && due.baselineDate ? `last done ${maintenanceDay(due.baselineDate)}` : null;
  const interval = intervalWords(schedule.intervalMiles, schedule.intervalMonths);
  const byMiles = due.dueMiles === null || due.remainingMiles === null ? null : {
    limit: `at ${formatMiles(due.dueMiles)} mi`, remaining: due.remainingMiles,
    words: `${formatMiles(Math.abs(due.remainingMiles))} mi`, days: milesAsDays(due.remainingMiles, milesPerDay),
  };
  const byDate = due.dueDate === null || due.remainingDays === null ? null : {
    limit: `by ${maintenanceDay(due.dueDate)}`, remaining: due.remainingDays, words: spanWords(due.remainingDays), days: due.remainingDays,
  };
  if (due.state === null) return { interval, lastDone, limit: byMiles?.limit ?? byDate?.limit ?? null, status: "Off", tone: "off", days: Number.POSITIVE_INFINITY };
  if (due.state === "needs-baseline") return { interval, lastDone, limit: null, status: "Needs a date", tone: "unknown", days: Number.POSITIVE_INFINITY };
  const known = [byMiles, byDate].filter((limit) => limit !== null);
  // Past due: show the limit that was passed (miles first when both were). Otherwise the one reached first.
  const shown = known.find((limit) => limit.remaining <= 0) ?? [...known].sort((a, b) => a.days - b.days)[0];
  if (!shown) return { interval, lastDone, limit: null, status: "Needs a date", tone: "unknown", days: Number.POSITIVE_INFINITY };
  const past = shown.remaining <= 0;
  const days = Math.min(...known.map((limit) => limit.days));
  return {
    interval,
    lastDone,
    limit: shown.limit,
    status: past ? `${shown.words} past` : `${shown.words} left`,
    // Optional work never looks urgent: its distance shows, but quietly.
    tone: schedule.optional ? "off" : due.state === "overdue" ? "due" : due.state === "due-soon" ? "soon" : "ok",
    days,
  };
}

export type LedgerGroup = "overdue" | "due-soon" | "needs-baseline" | "upcoming" | "optional" | "off";
export const ledgerGroups: { key: LedgerGroup; title: string }[] = [
  { key: "overdue", title: "Overdue" },
  { key: "due-soon", title: "Due soon" },
  { key: "needs-baseline", title: "Needs a start date" },
  { key: "upcoming", title: "Coming up" },
  { key: "optional", title: "Optional" },
  { key: "off", title: "Turned off" },
];

export type LedgerItem = HouseholdMaintenanceDue & { line: LedgerLine };

const groupOf = ({ due }: HouseholdMaintenanceDue): LedgerGroup =>
  due.state === null ? "off" : due.schedule.optional ? "optional" : due.state;

/** Group schedules for the ledger, nearest first within each group. Optional work gets its own group. */
export function groupLedger(items: HouseholdMaintenanceDue[], milesPerDay: (carId: number) => number | null) {
  const lines: LedgerItem[] = items.map((item) => ({ ...item, line: ledgerLine(item.due, milesPerDay(item.carId)) }));
  return ledgerGroups.map((group) => ({
    ...group,
    items: lines.filter((item) => groupOf(item) === group.key).sort((a, b) => a.line.days - b.line.days || a.due.schedule.title.localeCompare(b.due.schedule.title)),
  })).filter((group) => group.items.length > 0);
}

/** Counts for a car card or the greeting: what needs a look now. Optional work never counts. */
export function attentionCounts(all: HouseholdMaintenanceDue[]) {
  const items = all.filter(({ due }) => !due.schedule.optional);
  const count = (state: string) => items.filter(({ due }) => due.state === state).length;
  return { overdue: count("overdue"), soon: count("due-soon"), unknown: count("needs-baseline"), total: items.filter(({ due }) => due.state !== null).length };
}

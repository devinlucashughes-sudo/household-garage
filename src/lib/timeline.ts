import { and, eq } from "drizzle-orm";
import type { QueryDatabase } from "./db";
import { dateInputValue } from "./format";
import { calculateMpg } from "./fuel-mpg";
import { budgetFuelFor } from "./budget-fuel";
import { fuelRecords, odometerReadings, serviceRecords } from "./schema";

export const TIMELINE_FILTERS = ["all", "service", "quote", "fuel", "reading"] as const;
export type TimelineFilter = typeof TIMELINE_FILTERS[number];
export type TimelineEntry = {
  key: string; kind: Exclude<TimelineFilter, "all">; id: number; date: string;
  title: string; description: string | null; miles: number | null;
  costCents: number | null; href: string; mpg: number | null;
};

/** Owned service/fuel readings appear with their event, so they are not listed twice. */
export function timelineFor(db: QueryDatabase, carId: number, filter: TimelineFilter = "all"): TimelineEntry[] {
  if (!(TIMELINE_FILTERS as readonly string[]).includes(filter)) throw new Error("Choose a valid timeline filter.");
  const services = db.select().from(serviceRecords).where(eq(serviceRecords.carId, carId)).all();
  const fuel = db.select().from(fuelRecords).where(eq(fuelRecords.carId, carId)).all();
  const budgetFuel = budgetFuelFor(db, carId);
  const readings = db.select().from(odometerReadings).where(and(eq(odometerReadings.carId, carId), eq(odometerReadings.source, "manual"))).all();
  const mpg = new Map(calculateMpg(fuel, budgetFuel).map((result) => [result.id, result.mpg]));
  const entries: TimelineEntry[] = [
    ...services.map((record): TimelineEntry => ({ key: `${record.kind}:${record.id}`, kind: record.kind, id: record.id,
      date: record.date, title: record.title, description: record.shop, miles: record.miles,
      costCents: record.totalCents, href: `/cars/${carId}/services/${record.id}`, mpg: null })),
    ...fuel.map((record): TimelineEntry => ({ key: `fuel:${record.id}`, kind: "fuel", id: record.id,
      date: record.date, title: record.fullTank ? "Full-tank fill-up" : "Partial fill-up",
      description: `${(record.gallonsMilli / 1000).toFixed(3)} US gallons${record.missedFillups ? "; a fill-up was missed" : ""}`,
      miles: record.miles, costCents: record.totalCents, href: `/cars/${carId}/fuel/${record.id}`, mpg: mpg.get(record.id) ?? null })),
    ...budgetFuel.map((payment): TimelineEntry => ({ key: `budget-fuel:${payment.id}`, kind: "fuel", id: payment.id,
      date: payment.date, title: "Budget gas payment", description: payment.payee || null,
      miles: null, costCents: payment.totalCents, href: `/cars/${carId}/fuel/budget/${payment.id}`, mpg: null })),
    ...readings.map((record): TimelineEntry => ({ key: `reading:${record.id}`, kind: "reading", id: record.id,
      date: dateInputValue(record.readAt), title: "Manual odometer reading", description: record.note,
      miles: record.miles, costCents: null, href: `/cars/${carId}/mileage`, mpg: null })),
  ];
  return entries.filter((entry) => filter === "all" || entry.kind === filter)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.miles ?? -1) - (a.miles ?? -1) || b.id - a.id || a.kind.localeCompare(b.kind));
}

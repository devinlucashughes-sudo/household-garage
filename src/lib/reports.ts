import { and, asc, eq } from "drizzle-orm";
import type { QueryDatabase } from "./db";
import { COST_CATEGORIES, type CostCategory } from "./cost-categories";
import { budgetFuelPayments, cars, fuelRecords, odometerReadings, serviceRecords } from "./schema";

export type ReportPeriod = { kind: "all" } | { kind: "year"; year: string };
export type ReportSearch = Record<string, string | string[] | undefined>;

const validYear = (year: string) => /^\d{4}$/.test(year) && year >= "1900";

/** The year in the address, or all time. Old or mistyped addresses show all time rather than an error. */
export function reportPeriodFromSearch(search: ReportSearch): ReportPeriod {
  const year = search.year;
  return typeof year === "string" && validYear(year) ? { kind: "year", year } : { kind: "all" };
}

/** The car picked on the Costs tab, or null for all cars. The page ignores a car that doesn't exist. */
export function reportCarFromSearch(search: ReportSearch): number | null {
  const car = search.car;
  return typeof car === "string" && /^[1-9]\d{0,8}$/.test(car) ? Number(car) : null;
}

export const reportIncludesDate = (date: string, period: ReportPeriod) => period.kind === "all" || date.startsWith(`${period.year}-`);
/** "?car=1&year=2025", "?year=2025", or nothing for all cars, all time. */
export function reportQuery(period: ReportPeriod, carId: number | null = null) {
  const parts = [carId !== null && `car=${carId}`, period.kind === "year" && `year=${period.year}`].filter(Boolean);
  return parts.length ? `?${parts.join("&")}` : "";
}
export const reportPeriodQuery = (period: ReportPeriod) => reportQuery(period);
/** A Costs address narrowed to one year, whether or not it already picks a car. */
export const yearHref = (href: string, year: string) => `${href}${href.includes("?") ? "&" : "?"}year=${year}`;

/** One fill-up, budget fuel payment or completed service. A null amount is unknown, not $0. */
export type CostItem = {
  carId: number; date: string; category: CostCategory; cents: number | null;
  serviceId: number | null; title: string | null; shop: string | null;
};
export type CategoryTotal = { category: CostCategory; cents: number; count: number; unknownCount: number };
/** `categories` lists only the kinds with records, in the fixed category order. */
export type CostTotals = { knownCents: number; count: number; unknownCount: number; categories: CategoryTotal[] };
export type YearTotals = CostTotals & { year: string };
export type ReportEndpoint = { date: string; miles: number };
export type ReportMileage = {
  readingCount: number;
  first: ReportEndpoint | null;
  last: ReportEndpoint | null;
  distanceMiles: number | null;
  unavailableReason: "too-few-readings" | "zero-distance" | "decreasing-readings" | null;
  knownCentsInSpan: number;
  unknownCountInSpan: number;
  recordsOutsideSpan: number;
  knownCentsOutsideSpan: number;
  /** Cents per mile, unrounded. Only the known costs dated inside the displayed span. */
  knownCentsPerMile: number | null;
};
export type CarCostReport = {
  carId: number; nickname: string; totals: CostTotals;
  /** Every calendar year from the car's first record to its last, oldest first, whatever the period. */
  years: YearTotals[];
  mileage: ReportMileage;
};
export type CostReport = { period: ReportPeriod; totals: CostTotals; years: YearTotals[]; cars: CarCostReport[]; items: CostItem[] };
export type ReportData = {
  cars: readonly Pick<typeof cars.$inferSelect, "id" | "nickname">[];
  services: readonly Pick<typeof serviceRecords.$inferSelect, "id" | "carId" | "kind" | "date" | "totalCents" | "category" | "title" | "shop">[];
  fuel: readonly Pick<typeof fuelRecords.$inferSelect, "id" | "carId" | "date" | "totalCents">[];
  budgetFuel?: readonly (Pick<typeof budgetFuelPayments.$inferSelect, "id" | "carId" | "date" | "totalCents"> & { payee?: string })[];
  readings: readonly Pick<typeof odometerReadings.$inferSelect, "carId" | "source" | "sourceId" | "readAt" | "miles">[];
};

export function totalCosts(costs: readonly CostItem[]): CostTotals {
  const all = COST_CATEGORIES.map((category): CategoryTotal => ({ category, cents: 0, count: 0, unknownCount: 0 }));
  for (const cost of costs) {
    const total = all[COST_CATEGORIES.indexOf(cost.category)];
    total.count++;
    if (cost.cents === null) total.unknownCount++; else total.cents += cost.cents;
  }
  const categories = all.filter((total) => total.count > 0);
  return {
    knownCents: categories.reduce((sum, total) => sum + total.cents, 0), count: costs.length,
    unknownCount: categories.reduce((sum, total) => sum + total.unknownCount, 0), categories,
  };
}

/** A kind's total, or zeros when there are no records of that kind. */
export const categoryTotal = (totals: CostTotals, category: CostCategory): CategoryTotal =>
  totals.categories.find((total) => total.category === category) ?? { category, cents: 0, count: 0, unknownCount: 0 };

function yearTotals(costs: readonly CostItem[]): YearTotals[] {
  if (!costs.length) return [];
  const years = costs.map((cost) => Number(cost.date.slice(0, 4)));
  const first = Math.min(...years);
  return Array.from({ length: Math.max(...years) - first + 1 }, (_, i) => {
    const year = String(first + i);
    return { year, ...totalCosts(costs.filter((cost) => cost.date.startsWith(`${year}-`))) };
  });
}

/** No extrapolation, purchase assumptions or lifetime-odometer divisor. Date-only costs use inclusive calendar days. */
function mileageCoverage(readings: { date: string; miles: number; at: number }[], costs: readonly CostItem[]): ReportMileage {
  readings.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at || a.miles - b.miles);
  const first = readings[0] ? { date: readings[0].date, miles: readings[0].miles } : null;
  const end = readings.at(-1);
  const last = end ? { date: end.date, miles: end.miles } : null;
  const decreasing = readings.some((reading, i) => i > 0 && reading.miles < readings[i - 1].miles);
  const distance = first && last ? last.miles - first.miles : 0;
  const unavailableReason = readings.length < 2 ? "too-few-readings" : decreasing ? "decreasing-readings" : distance <= 0 ? "zero-distance" : null;
  const inside = first && last ? costs.filter((cost) => cost.date >= first.date && cost.date <= last.date) : [];
  const covered = totalCosts(inside);
  const total = totalCosts(costs);
  return {
    readingCount: readings.length, first, last,
    distanceMiles: unavailableReason ? null : distance, unavailableReason,
    knownCentsInSpan: covered.knownCents, unknownCountInSpan: covered.unknownCount,
    recordsOutsideSpan: costs.length - inside.length, knownCentsOutsideSpan: total.knownCents - covered.knownCents,
    knownCentsPerMile: unavailableReason || covered.count - covered.unknownCount === 0 ? null : covered.knownCents / distance,
  };
}

/** Pure report engine. Inputs may contain other cars; only listed cars contribute. Quotes never count. */
export function calculateCostReport(data: ReportData, period: ReportPeriod = { kind: "all" }, timeZone = process.env.TZ_NAME || "America/Chicago"): CostReport {
  if (period.kind === "year" && !validYear(period.year)) throw new Error("Invalid report period.");
  const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const everything: CostItem[] = [];
  const reports = data.cars.map((car): CarCostReport => {
    const services = data.services.filter((record) => record.carId === car.id && record.kind === "service");
    const fuel = data.fuel.filter((record) => record.carId === car.id);
    const all: CostItem[] = [
      ...services.map((record): CostItem => ({ carId: car.id, date: record.date, category: record.category, cents: record.totalCents, serviceId: record.id, title: record.title, shop: record.shop })),
      ...fuel.map((record): CostItem => ({ carId: car.id, date: record.date, category: "fuel", cents: record.totalCents, serviceId: null, title: null, shop: null })),
      ...(data.budgetFuel ?? []).filter((record) => record.carId === car.id)
        .map((record): CostItem => ({ carId: car.id, date: record.date, category: "fuel", cents: record.totalCents, serviceId: null, title: null, shop: record.payee ?? null })),
    ];
    everything.push(...all);
    const costs = all.filter((cost) => reportIncludesDate(cost.date, period));
    const serviceIds = new Set(services.map((record) => record.id));
    const fuelIds = new Set(fuel.map((record) => record.id));
    // Ignore dangling or quote-linked readings as well as every unapproved draft.
    const readings = data.readings.filter((reading) => reading.carId === car.id && (reading.source === "manual"
      || (reading.source === "service" && reading.sourceId !== null && serviceIds.has(reading.sourceId))
      || (reading.source === "fill-up" && reading.sourceId !== null && fuelIds.has(reading.sourceId))))
      .map((reading) => ({ date: dayFormatter.format(reading.readAt), miles: reading.miles, at: reading.readAt }))
      .filter((reading) => reportIncludesDate(reading.date, period));
    return { carId: car.id, nickname: car.nickname, totals: totalCosts(costs), years: yearTotals(all), mileage: mileageCoverage(readings, costs) };
  });
  const items = everything.filter((cost) => reportIncludesDate(cost.date, period))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.serviceId ?? 0) - (a.serviceId ?? 0));
  return { period, totals: totalCosts(items), years: yearTotals(everything), cars: reports, items };
}

/** Reads recorded tables directly. Pass carId for an isolated per-car report; unknown cars yield no rows. */
export function reportsFor(db: QueryDatabase, period: ReportPeriod = { kind: "all" }, carId?: number): CostReport {
  const selectedCars = db.select({ id: cars.id, nickname: cars.nickname }).from(cars)
    .where(carId === undefined ? undefined : eq(cars.id, carId)).orderBy(asc(cars.createdAt), asc(cars.id)).all();
  const services = db.select({
    id: serviceRecords.id, carId: serviceRecords.carId, kind: serviceRecords.kind, date: serviceRecords.date, totalCents: serviceRecords.totalCents,
    category: serviceRecords.category, title: serviceRecords.title, shop: serviceRecords.shop,
  }).from(serviceRecords).where(and(eq(serviceRecords.kind, "service"), carId === undefined ? undefined : eq(serviceRecords.carId, carId))).all();
  const fuel = db.select({ id: fuelRecords.id, carId: fuelRecords.carId, date: fuelRecords.date, totalCents: fuelRecords.totalCents })
    .from(fuelRecords).where(carId === undefined ? undefined : eq(fuelRecords.carId, carId)).all();
  const budgetFuel = db.select({ id: budgetFuelPayments.id, carId: budgetFuelPayments.carId, date: budgetFuelPayments.date, totalCents: budgetFuelPayments.totalCents, payee: budgetFuelPayments.payee })
    .from(budgetFuelPayments).where(carId === undefined ? undefined : eq(budgetFuelPayments.carId, carId)).all();
  const readings = db.select({ carId: odometerReadings.carId, source: odometerReadings.source, sourceId: odometerReadings.sourceId, readAt: odometerReadings.readAt, miles: odometerReadings.miles })
    .from(odometerReadings).where(carId === undefined ? undefined : eq(odometerReadings.carId, carId)).all();
  return calculateCostReport({ cars: selectedCars, services, fuel, budgetFuel, readings }, period);
}

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database";
import type { ServiceCategory } from "@/lib/cost-categories";
import { cars, fuelRecords, importDrafts, odometerReadings, serviceRecords } from "@/lib/schema";
import { calculateCostReport, categoryTotal, reportIncludesDate, reportPeriodFromSearch, reportPeriodQuery, reportsFor, type ReportPeriod } from "@/lib/reports";

process.env.TZ_NAME = "America/Chicago";
const all: ReportPeriod = { kind: "all" };
const y2026: ReportPeriod = { kind: "year", year: "2026" };
const connections: ReturnType<typeof openDatabase>[] = [];
const fresh = () => {
  const connection = openDatabase(":memory:"); connections.push(connection);
  connection.db.insert(cars).values([{ id: 1, nickname: "Synthetic one", createdAt: 1, updatedAt: 1 }, { id: 2, nickname: "Synthetic two", createdAt: 2, updatedAt: 2 }]).run();
  return connection.db;
};
type Db = ReturnType<typeof fresh>;
const service = (db: Db, carId: number, date: string, totalCents: number | null, category: ServiceCategory = "maintenance", kind: "quote" | "service" = "service") => db.insert(serviceRecords).values({
  carId, date, totalCents, kind, category, title: "Synthetic work", lineItems: JSON.stringify([{ description: "Already in paid total", costCents: 999999 }]), requestKey: randomUUID(), createdAt: 1, updatedAt: 1,
}).returning().get();
const fuel = (db: Db, carId: number, date: string, totalCents: number) => db.insert(fuelRecords).values({
  carId, date, totalCents, miles: 1200, gallonsMilli: 10000, fullTank: true, requestKey: randomUUID(), createdAt: 1, updatedAt: 1,
}).returning().get();
const reading = (db: Db, carId: number, date: string, miles: number, source: "manual" | "service" | "fill-up" = "manual", sourceId: number | null = null) => db.insert(odometerReadings).values({
  carId, miles, readAt: Date.parse(`${date}T12:00:00Z`), source, sourceId, createdAt: 1,
}).run();
afterEach(() => { for (const { sqlite } of connections.splice(0)) sqlite.close(); });

describe("costs by kind", () => {
  it("isolates cars and totals fuel plus paid service once, without line-item double counting", () => {
    const db = fresh(); service(db, 1, "2026-10-01", 12345, "repairs"); fuel(db, 1, "2026-10-02", 5067);
    service(db, 2, "2026-10-01", 99999); fuel(db, 2, "2026-10-02", 8765);
    const one = reportsFor(db, all, 1);
    expect(one.totals).toMatchObject({ knownCents: 17412, count: 2, unknownCount: 0 });
    expect(one.totals.categories).toEqual([
      { category: "fuel", cents: 5067, count: 1, unknownCount: 0 },
      { category: "repairs", cents: 12345, count: 1, unknownCount: 0 },
    ]);
    expect(one.cars.map((car) => car.carId)).toEqual([1]);
    expect(reportsFor(db).totals.knownCents).toBe(126176);
    expect(reportsFor(db, all, 999).cars).toEqual([]);
    expect(reportsFor(db, all, 999).totals.knownCents).toBe(0);
  });
  it("lists kinds in the fixed order, leaving out kinds with no records", () => {
    const db = fresh();
    for (const category of ["body", "oil", "repairs", "tires"] as const) service(db, 1, "2026-01-01", 100, category);
    fuel(db, 1, "2026-01-02", 100);
    expect(reportsFor(db, all, 1).totals.categories.map((total) => total.category)).toEqual(["fuel", "oil", "tires", "repairs", "body"]);
    expect(categoryTotal(reportsFor(db, all, 1).totals, "maintenance")).toEqual({ category: "maintenance", cents: 0, count: 0, unknownCount: 0 });
  });
  it("excludes quotes, import drafts and their proposed amounts, dates and mileage", () => {
    const db = fresh(); service(db, 1, "2026-10-10", 1000);
    const quote = service(db, 1, "2026-10-01", 99999, "repairs", "quote");
    db.insert(importDrafts).values({ id: randomUUID(), carId: 1, type: "service", payload: JSON.stringify({ date: "2025-09-01", totalCents: 88888, miles: 5000 }), payloadHash: "synthetic", idempotencyKey: randomUUID(), status: "draft", createdAt: 1, updatedAt: 1 }).run();
    reading(db, 1, "2026-10-01", 1, "service", quote.id);
    reading(db, 1, "2026-10-02", 5, "fill-up", 9999);
    const report = reportsFor(db, all, 1);
    expect(report.totals).toMatchObject({ knownCents: 1000, count: 1 });
    expect(report.years.map((year) => year.year)).toEqual(["2026"]);
    expect(report.items).toHaveLength(1);
    expect(report.cars[0].mileage.readingCount).toBe(0);
  });
  it("keeps unknown costs apart from explicit zero, even when line items have costs", () => {
    const db = fresh(); service(db, 1, "2026-10-01", null, "repairs"); service(db, 1, "2026-10-02", 0, "repairs"); service(db, 1, "2026-10-03", 100, "oil");
    const totals = reportsFor(db, y2026, 1).totals;
    expect(totals).toMatchObject({ knownCents: 100, count: 3, unknownCount: 1 });
    expect(categoryTotal(totals, "repairs")).toEqual({ category: "repairs", cents: 0, count: 2, unknownCount: 1 });
  });
  it("filters by calendar year, including leap days and excluding neighboring years", () => {
    const db = fresh();
    for (const date of ["2025-12-31", "2026-01-01", "2026-02-28", "2026-12-31", "2027-01-01", "2024-02-29"]) service(db, 1, date, 100);
    expect(reportsFor(db, y2026, 1).totals.count).toBe(3);
    expect(reportsFor(db, { kind: "year", year: "2024" }, 1).totals.count).toBe(1);
    expect(reportsFor(db, all, 1).totals.count).toBe(6);
  });
  it("totals every year from the first record to the last, oldest first, whatever the period", () => {
    const db = fresh(); service(db, 1, "2023-05-01", 300, "tires"); service(db, 1, "2026-01-01", null);
    fuel(db, 1, "2026-10-01", 500); service(db, 2, "2025-10-01", 200, "repairs");
    const report = reportsFor(db, y2026);
    expect(report.years.map((year) => [year.year, year.knownCents, year.count, year.unknownCount])).toEqual([["2023", 300, 1, 0], ["2024", 0, 0, 0], ["2025", 200, 1, 0], ["2026", 500, 2, 1]]);
    expect(report.cars[0].years.map((year) => year.year)).toEqual(["2023", "2024", "2025", "2026"]);
    expect(report.cars[1].years.map((year) => year.year)).toEqual(["2025"]);
    expect(report.totals.knownCents).toBe(500);
  });
  it("lists the period's records newest first with what each category page needs", () => {
    const db = fresh(); const work = service(db, 1, "2026-03-01", 4200, "oil"); fuel(db, 1, "2026-04-01", 3000); service(db, 1, "2025-03-01", 100);
    expect(reportsFor(db, y2026, 1).items).toEqual([
      { carId: 1, date: "2026-04-01", category: "fuel", cents: 3000, serviceId: null, title: null, shop: null },
      { carId: 1, date: "2026-03-01", category: "oil", cents: 4200, serviceId: work.id, title: "Synthetic work", shop: null },
    ]);
  });
  it("recomputes after record edits, recategorizing and deletion without caching stale totals", () => {
    const db = fresh(); const record = service(db, 1, "2026-10-10", 100);
    expect(categoryTotal(reportsFor(db).totals, "maintenance").cents).toBe(100);
    db.update(serviceRecords).set({ category: "repairs" }).run();
    expect(reportsFor(db).totals.categories.map((total) => total.category)).toEqual(["repairs"]);
    db.update(serviceRecords).set({ totalCents: null }).run();
    expect(reportsFor(db).totals).toMatchObject({ knownCents: 0, unknownCount: 1 });
    db.delete(serviceRecords).run();
    expect(reportsFor(db).totals.count).toBe(0); expect(record.id).toBeGreaterThan(0);
  });
});

describe("known cost per recorded mile", () => {
  it("uses only in-period mileage and costs inside a partial recorded span", () => {
    const db = fresh(); reading(db, 1, "2025-12-30", 1000); reading(db, 1, "2026-03-10", 1200); reading(db, 1, "2026-06-20", 1500); reading(db, 1, "2027-01-01", 1700);
    service(db, 1, "2026-01-01", 5000); fuel(db, 1, "2026-03-10", 3000); service(db, 1, "2026-04-15", 6000); service(db, 1, "2026-04-16", null); fuel(db, 1, "2026-06-20", 1000); service(db, 1, "2026-12-31", 2000);
    reading(db, 2, "2026-01-01", 100); reading(db, 2, "2026-12-31", 9000);
    const report = reportsFor(db, y2026, 1);
    expect(report.totals.knownCents).toBe(17000);
    expect(report.cars[0].mileage).toEqual({ readingCount: 2, first: { date: "2026-03-10", miles: 1200 }, last: { date: "2026-06-20", miles: 1500 }, distanceMiles: 300, unavailableReason: null, knownCentsInSpan: 10000, unknownCountInSpan: 1, recordsOutsideSpan: 2, knownCentsOutsideSpan: 7000, knownCentsPerMile: 10000 / 300 });
  });
  it("never divides by zero, one reading, negative or internally decreasing mileage", () => {
    const db = fresh(); service(db, 1, "2026-10-10", 100);
    expect(reportsFor(db, y2026, 1).cars[0].mileage).toMatchObject({ unavailableReason: "too-few-readings", knownCentsPerMile: null });
    reading(db, 1, "2026-10-01", 1000);
    expect(reportsFor(db, y2026, 1).cars[0].mileage.knownCentsPerMile).toBeNull();
    reading(db, 1, "2026-10-10", 1000);
    expect(reportsFor(db, y2026, 1).cars[0].mileage).toMatchObject({ unavailableReason: "zero-distance", distanceMiles: null, knownCentsPerMile: null });
    reading(db, 1, "2026-10-15", 900);
    expect(reportsFor(db, y2026, 1).cars[0].mileage.unavailableReason).toBe("decreasing-readings");
    reading(db, 1, "2026-10-20", 2000);
    expect(reportsFor(db, y2026, 1).cars[0].mileage).toMatchObject({ unavailableReason: "decreasing-readings", knownCentsPerMile: null });
  });
  it("does not turn unknown-only or absent costs into a zero ratio; explicitly free work is zero", () => {
    const db = fresh(); reading(db, 1, "2026-10-01", 0); reading(db, 1, "2026-10-31", 1000);
    expect(reportsFor(db, y2026, 1).cars[0].mileage.knownCentsPerMile).toBeNull();
    service(db, 1, "2026-10-10", null);
    expect(reportsFor(db, y2026, 1).cars[0].mileage.knownCentsPerMile).toBeNull();
    service(db, 1, "2026-10-15", 0);
    expect(reportsFor(db, y2026, 1).cars[0].mileage).toMatchObject({ knownCentsPerMile: 0, unknownCountInSpan: 1 });
  });
  it("reads linked fuel and completed service odometers without letting another car's source links contribute", () => {
    const db = fresh(); const fill = fuel(db, 1, "2026-10-01", 1000); const work = service(db, 1, "2026-10-31", 3000); const other = service(db, 2, "2026-10-01", 9999);
    reading(db, 1, "2026-10-01", 100, "fill-up", fill.id); reading(db, 1, "2026-10-31", 200, "service", work.id);
    reading(db, 1, "2026-10-01", 0, "service", other.id);
    expect(reportsFor(db, y2026, 1).cars[0].mileage).toMatchObject({ readingCount: 2, distanceMiles: 100, knownCentsPerMile: 40 });
  });
  it("uses the household calendar date for timestamp readings at year boundaries", () => {
    const db = fresh(); service(db, 1, "2025-12-31", 500); service(db, 1, "2026-01-01", 500);
    for (const [readAt, miles] of [[Date.parse("2026-01-01T05:59:00Z"), 100], [Date.parse("2026-01-01T06:00:00Z"), 200]] as const) db.insert(odometerReadings).values({ carId: 1, readAt, miles, source: "manual", createdAt: 1 }).run();
    expect(reportsFor(db, y2026, 1).cars[0].mileage).toMatchObject({ readingCount: 1, first: { date: "2026-01-01", miles: 200 }, knownCentsPerMile: null });
    expect(reportsFor(db, all, 1).cars[0].mileage.knownCentsPerMile).toBe(10);
  });
});

describe("report period", () => {
  it("reads a year from the address and shows all time for anything else", () => {
    expect(reportPeriodFromSearch({})).toEqual(all);
    expect(reportPeriodFromSearch({ year: "2026" })).toEqual(y2026);
    for (const year of ["wrong", "1899", "20e3", "026", ["2025", "2026"]]) expect(reportPeriodFromSearch({ year })).toEqual(all);
    expect(reportPeriodFromSearch({ period: "month", month: "2026-10" })).toEqual(all);
    expect(reportPeriodQuery(y2026)).toBe("?year=2026"); expect(reportPeriodQuery(all)).toBe("");
    expect(reportIncludesDate("2026-10-01", y2026)).toBe(true); expect(reportIncludesDate("2025-12-31", y2026)).toBe(false);
    expect(() => calculateCostReport({ cars: [], services: [], fuel: [], readings: [] }, { kind: "year", year: "99" })).toThrow("Invalid report period");
  });
});

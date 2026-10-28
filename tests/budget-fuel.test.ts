import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { budgetFuelFor, importBudgetFuel, type BudgetFuelInput } from "@/lib/budget-fuel";
import { readingsFor } from "@/lib/cars";
import { openDatabase } from "./database";
import { fuelFor, saveFuel } from "@/lib/fuel";
import { calculateMpg } from "@/lib/fuel-mpg";
import { calculateCostReport, categoryTotal, reportsFor } from "@/lib/reports";
import { cars } from "@/lib/schema";
import { timelineFor } from "@/lib/timeline";

const now = Date.UTC(2026, 9, 26, 17);
const connections: ReturnType<typeof openDatabase>[] = [];
function fresh() {
  const connection = openDatabase(":memory:"); connections.push(connection);
  connection.db.insert(cars).values([
    { id: 1, nickname: "One", createdAt: 1, updatedAt: 1 },
    { id: 2, nickname: "Two", createdAt: 1, updatedAt: 1 },
  ]).run();
  return connection.db;
}
const input = (changes: Partial<BudgetFuelInput> = {}): BudgetFuelInput => ({
  carId: 1, date: "2026-10-12", totalCents: 3042, payee: "Station", memo: "Car",
  sourceFile: "budget.csv", sourceRecord: 2, sourceKey: "a".repeat(64), ...changes,
});
afterEach(() => { for (const { sqlite } of connections.splice(0)) sqlite.close(); });

describe("budget fuel payments", () => {
  it("adds known costs to the right car and period without creating mileage", () => {
    const db = fresh();
    importBudgetFuel(db, [input(), input({ carId: 2, totalCents: 555, sourceKey: "b".repeat(64), sourceRecord: 3 })], { apply: true, now });
    expect(readingsFor(db, 1)).toEqual([]);
    expect(categoryTotal(reportsFor(db).totals, "fuel")).toMatchObject({ cents: 3597, count: 2 });
    expect(categoryTotal(reportsFor(db, { kind: "year", year: "2026" }, 1).totals, "fuel")).toMatchObject({ cents: 3042, count: 1 });
    expect(categoryTotal(reportsFor(db, { kind: "year", year: "2025" }, 1).totals, "fuel").cents).toBe(0);
    expect(timelineFor(db, 1, "fuel")).toMatchObject([{ title: "Budget gas payment", miles: null, costCents: 3042, href: "/cars/1/fuel/budget/1" }]);
  });
  it("checks first, applies once, and retries without duplicating a payment", () => {
    const db = fresh();
    expect(importBudgetFuel(db, [input()], { apply: false })).toEqual({ added: 1, alreadyImported: 0, total: 1 });
    expect(budgetFuelFor(db, 1)).toEqual([]);
    expect(importBudgetFuel(db, [input()], { apply: true })).toEqual({ added: 1, alreadyImported: 0, total: 1 });
    expect(importBudgetFuel(db, [input()], { apply: true })).toEqual({ added: 0, alreadyImported: 1, total: 1 });
    expect(budgetFuelFor(db, 1)).toHaveLength(1);
  });
  it("rolls back the batch on conflicting sources or possible manual duplicates", () => {
    const db = fresh();
    importBudgetFuel(db, [input()], { apply: true });
    expect(() => importBudgetFuel(db, [input({ sourceKey: "b".repeat(64) }), input({ totalCents: 9999 })], { apply: true })).toThrow(/different values/);
    expect(budgetFuelFor(db, 1)).toHaveLength(1);
    saveFuel(db, 1, { date: "2026-10-14", miles: 10000, gallonsMilli: 10000, totalCents: 2000, fullTank: true, missedFillups: false, notes: null }, { requestKey: randomUUID(), now });
    expect(() => importBudgetFuel(db, [input({ sourceKey: "c".repeat(64), date: "2026-10-14", totalCents: 2000 })], { apply: true })).toThrow(/same car, date and amount/);
    expect(budgetFuelFor(db, 1)).toHaveLength(1);
    expect(() => importBudgetFuel(db, [input(), input()], { apply: true })).toThrow(/repeated source keys/);
  });
  it("breaks MPG for an unknown payment inside or on the boundary of an interval", () => {
    const db = fresh();
    const fill = (date: string, miles: number) => saveFuel(db, 1, { date, miles, gallonsMilli: 10000, totalCents: 2500, fullTank: true, missedFillups: false, notes: null }, { requestKey: randomUUID(), now });
    fill("2026-10-10", 10000); fill("2026-10-14", 10300); fill("2026-10-16", 10600);
    expect(calculateMpg(fuelFor(db, 1)).map((result) => result.mpg)).toEqual([30, 30, null]);
    importBudgetFuel(db, [input()], { apply: true });
    const mpg = calculateMpg(fuelFor(db, 1), budgetFuelFor(db, 1));
    expect(mpg.map((result) => result.mpg)).toEqual([30, null, null]);
    expect(mpg[1].reason).toBe("missed-fill");
    expect(calculateMpg(fuelFor(db, 1), [{ carId: 1, date: "2026-10-10" }])[1].mpg).toBeNull();
    expect(calculateMpg(fuelFor(db, 1), [{ carId: 2, date: "2026-10-12" }])[1].mpg).toBe(30);
  });
  it("does not treat a budget payment ID as a fill-up mileage source", () => {
    const report = calculateCostReport({ cars: [{ id: 1, nickname: "One" }], services: [], fuel: [],
      budgetFuel: [{ id: 7, carId: 1, date: "2026-10-12", totalCents: 3042 }],
      readings: [{ carId: 1, source: "fill-up", sourceId: 7, readAt: now, miles: 1000 }],
    });
    expect(categoryTotal(report.totals, "fuel").cents).toBe(3042);
    expect(report.cars[0].mileage.readingCount).toBe(0);
  });
});

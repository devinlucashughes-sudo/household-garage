import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "./database";
import { budgetFuelPayments, cars } from "@/lib/schema";

const state = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/lib/session", () => ({ requireUser: async () => {
  if (!state.signedIn) throw new Error("sign-in-required");
  return { id: 1 };
} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDatabase: () => connection.db }));
import FuelHistoryPage from "@/app/(garage)/cars/[id]/fuel/page";
import BudgetFuelPage from "@/app/(garage)/cars/[id]/fuel/budget/[paymentId]/page";
import CarCostsPage from "@/app/(garage)/cars/[id]/costs/page";
let connection: ReturnType<typeof openDatabase>;

beforeEach(() => {
  connection = openDatabase(":memory:"); state.signedIn = true;
  connection.db.insert(cars).values([
    { id: 1, nickname: "One", createdAt: 1, updatedAt: 1 },
    { id: 2, nickname: "Two", createdAt: 1, updatedAt: 1 },
  ]).run();
  connection.db.insert(budgetFuelPayments).values({
    carId: 1, date: "2025-04-12", totalCents: 3042, payee: "Synthetic station", memo: "Synthetic memo",
    sourceFile: "synthetic-budget.csv", sourceRecord: 7, sourceKey: "a".repeat(64), importedAt: 1,
  }).run();
});
afterEach(() => connection.sqlite.close());

describe("budget fuel routes", () => {
  it("shows a payment in the car's fuel history, details, and cost report", async () => {
    const history = renderToStaticMarkup(await FuelHistoryPage({ params: Promise.resolve({ id: "1" }) }));
    expect(history).toContain("$30.42"); expect(history).toContain("gallons and mileage unknown");
    expect(history).toContain("/cars/1/fuel/budget/1");
    const detail = renderToStaticMarkup(await BudgetFuelPage({ params: Promise.resolve({ id: "1", paymentId: "1" }) }));
    for (const value of ["$30.42", "Synthetic station", "Synthetic memo", "Not recorded", "synthetic-budget.csv", "CSV record 7"]) expect(detail).toContain(value);
    const report = renderToStaticMarkup(await CarCostsPage({ params: Promise.resolve({ id: "1" }), searchParams: Promise.resolve({}) }));
    expect(report).toContain("$30"); expect(report).toContain("1 fill-up"); expect(report).toContain('href="/cars/1/costs/fuel"');
  });
  it("requires sign-in and does not expose another car's payment", async () => {
    await expect(BudgetFuelPage({ params: Promise.resolve({ id: "2", paymentId: "1" }) })).rejects.toThrow("not-found");
    await expect(BudgetFuelPage({ params: Promise.resolve({ id: "1", paymentId: "bad" }) })).rejects.toThrow("not-found");
    state.signedIn = false;
    await expect(BudgetFuelPage({ params: Promise.resolve({ id: "1", paymentId: "1" }) })).rejects.toThrow("sign-in-required");
    await expect(FuelHistoryPage({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("sign-in-required");
  });
});

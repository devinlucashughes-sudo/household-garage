import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "./database";
import { cars, fuelRecords, odometerReadings, serviceRecords } from "@/lib/schema";

const state = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => {
  if (!state.signedIn) throw new Error("sign-in-required");
  return { id: 1 };
}) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); }, usePathname: () => "/reports" }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDatabase: () => connection.db }));
import ReportsPage from "@/app/(garage)/reports/page";
import CostCategoryPage from "@/app/(garage)/reports/[category]/page";
import CarCostsPage from "@/app/(garage)/cars/[id]/costs/page";
import CarCostCategoryPage from "@/app/(garage)/cars/[id]/costs/[category]/page";
import ReportError from "@/components/report-error";
import ReportsLoading from "@/app/(garage)/reports/loading";
import { requireUser } from "@/lib/session";
let connection: ReturnType<typeof openDatabase>;

beforeEach(() => {
  connection = openDatabase(":memory:"); state.signedIn = true; vi.clearAllMocks();
  connection.db.insert(cars).values([{ id: 1, nickname: "Synthetic car one", createdAt: 1, updatedAt: 1 }, { id: 2, nickname: "Synthetic car two", createdAt: 2, updatedAt: 2 }]).run();
  connection.db.insert(serviceRecords).values([
    { carId: 1, title: "Synthetic unknown repair", category: "repairs", date: "2026-10-15", kind: "service", totalCents: null, lineItems: "[]", requestKey: "unknown", createdAt: 1, updatedAt: 1 },
    { carId: 1, title: "Synthetic free rotation", category: "tires", date: "2026-10-16", kind: "service", totalCents: 0, lineItems: "[]", requestKey: "free", createdAt: 1, updatedAt: 1 },
    { carId: 1, title: "Synthetic old tires", category: "tires", date: "2024-05-01", kind: "service", totalCents: 40000, lineItems: "[]", requestKey: "old", createdAt: 1, updatedAt: 1 },
    { carId: 2, title: "Synthetic other work", category: "oil", date: "2026-10-16", kind: "service", totalCents: 99999, lineItems: "[]", requestKey: "other", createdAt: 1, updatedAt: 1 },
    { carId: 1, title: "Synthetic quote", category: "body", date: "2026-10-17", kind: "quote", totalCents: 77777, lineItems: "[]", requestKey: "quote", createdAt: 1, updatedAt: 1 },
  ]).run();
  connection.db.insert(fuelRecords).values({ carId: 1, date: "2026-10-10", totalCents: 3000, miles: 1000, gallonsMilli: 10000, fullTank: true, requestKey: "fuel", createdAt: 1, updatedAt: 1 }).run();
  connection.db.insert(odometerReadings).values([
    { carId: 1, miles: 1000, readAt: Date.parse("2026-10-10T12:00Z"), source: "manual", createdAt: 1 },
    { carId: 1, miles: 1300, readAt: Date.parse("2026-10-20T12:00Z"), source: "manual", createdAt: 1 },
  ]).run();
});
afterEach(() => connection.sqlite.close());
const search = (values = {}) => Promise.resolve(values);
const carPage = (id = "1", values = {}) => CarCostsPage({ params: Promise.resolve({ id }), searchParams: search(values) });
const html = async (page: Promise<React.ReactElement>) => renderToStaticMarkup(await page);

describe("cost routes", () => {
  it("requires household sign-in on every cost page before rendering records", async () => {
    state.signedIn = false;
    await expect(ReportsPage({ searchParams: search() })).rejects.toThrow("sign-in-required");
    await expect(carPage()).rejects.toThrow("sign-in-required");
    await expect(CostCategoryPage({ params: Promise.resolve({ category: "fuel" }), searchParams: search() })).rejects.toThrow("sign-in-required");
    await expect(CarCostCategoryPage({ params: Promise.resolve({ id: "1", category: "fuel" }), searchParams: search() })).rejects.toThrow("sign-in-required");
    expect(requireUser).toHaveBeenCalledTimes(4);
  });
  it("shows a car's costs by kind with links into each kind, years and cost per mile", async () => {
    const page = await html(carPage("1"));
    expect(page).toContain("Spent on Synthetic car one, all time"); expect(page).toContain("$430");
    expect(page).not.toContain("Synthetic car two"); expect(page).not.toContain("$1,000"); expect(page).not.toContain("$778");
    for (const kind of ["Fuel", "Tires", "Repairs"]) expect(page).toContain(`<b>${kind}</b>`);
    expect(page).not.toContain("<b>Body work</b>");
    expect(page).toContain('href="/cars/1/costs/tires"'); expect(page).toContain("1 repair · 1 no price");
    expect(page).toContain("1 record has no price yet, so it isn&#x27;t in this total.");
    expect(page).toContain("Year by year"); expect(page).toContain('aria-label="2025: nothing recorded"');
    expect(page).toContain('href="/cars/1/costs?year=2024"'); expect(page).toContain("What&#x27;s counted");
  });
  it("narrows a car's costs to a year and keeps the year on links into each kind", async () => {
    const page = await html(carPage("1", { year: "2026" }));
    expect(page).toContain("Spent on Synthetic car one, in 2026"); expect(page).toContain("$30");
    expect(page).toContain("about 10¢ a mile"); expect(page).toContain('href="/cars/1/costs/tires?year=2026"');
    expect(page).toContain('aria-current="page" aria-label="2026: $30"');
    const empty = await html(carPage("1", { year: "2019" }));
    expect(empty).toContain("Nothing recorded in 2019"); expect(empty).not.toContain("<b>Fuel</b>");
  });
  it("splits the household by car and by kind", async () => {
    const page = await html(ReportsPage({ searchParams: search() }));
    expect(page).toContain("Both cars, all time"); expect(page).toContain("$1,430");
    expect(page).toContain('href="/reports?car=1"'); expect(page).toContain('href="/reports?car=2"');
    expect(page).toContain('aria-current="page" href="/reports">All cars');
    expect(page).toContain("Where it went"); expect(page).toContain('href="/reports/oil"');
    expect(await html(ReportsPage({ searchParams: search({ year: "2026" }) }))).toContain('href="/reports?car=2&amp;year=2026"');
  });
  it("picks one car on the Costs tab, keeping the year on every link", async () => {
    const page = await html(ReportsPage({ searchParams: search({ car: "1", year: "2026" }) }));
    expect(page).toContain("Spent on Synthetic car one, in 2026"); expect(page).toContain("$30"); expect(page).toContain("about 10¢ a mile");
    expect(page).not.toContain("Both cars"); expect(page).not.toContain("$1,000");
    expect(page).toMatch(/aria-current="page" href="\/reports\?car=1&amp;year=2026"><i aria-hidden="true"><\/i><span>Synthetic car one/);
    expect(page).toContain('href="/reports?year=2026">All cars'); expect(page).toContain('href="/reports?car=2&amp;year=2026"');
    expect(page).toContain('href="/reports/tires?car=1&amp;year=2026"'); expect(page).toContain('href="/reports?car=1&amp;year=2024"');
    expect(page).toContain('href="/reports?car=1"');
    for (const car of ["999", "bad"]) expect(await html(ReportsPage({ searchParams: search({ car }) }))).toContain("Both cars, all time");
    const tires = await html(CostCategoryPage({ params: Promise.resolve({ category: "tires" }), searchParams: search({ car: "1", year: "2024" }) }));
    expect(tires).toContain("$400 on Synthetic car one in 2024"); expect(tires).toContain('href="/reports?car=1&amp;year=2024"');
    expect(tires).toContain('href="/reports/tires?car=1"');
    const oil = await html(CostCategoryPage({ params: Promise.resolve({ category: "oil" }), searchParams: search({ car: "1" }) }));
    expect(oil).toContain("No oil changes"); expect(oil).not.toContain("Synthetic other work");
    expect(await html(CostCategoryPage({ params: Promise.resolve({ category: "oil" }), searchParams: search({ car: "999" }) }))).toContain("on both cars");
  });
  it("opens one kind with its records by year, linking each service and leaving out quotes", async () => {
    const tires = await html(CarCostCategoryPage({ params: Promise.resolve({ id: "1", category: "tires" }), searchParams: search() }));
    expect(tires).toContain("$400 on Synthetic car one"); expect(tires).toContain("2 records");
    expect(tires).toContain("Synthetic free rotation"); expect(tires).toContain("$0.00"); expect(tires).toContain("$400.00");
    expect(tires).toMatch(/href="\/cars\/1\/services\/\d+"/); expect(tires.indexOf("2026")).toBeLessThan(tires.indexOf("2024"));
    const body = await html(CarCostCategoryPage({ params: Promise.resolve({ id: "1", category: "body" }), searchParams: search() }));
    expect(body).toContain("No records"); expect(body).not.toContain("Synthetic quote");
    const repairs = await html(CostCategoryPage({ params: Promise.resolve({ category: "repairs" }), searchParams: search() }));
    expect(repairs).toContain("No price on both cars"); expect(repairs).toContain("Synthetic car one</span>");
    const fuel = await html(CostCategoryPage({ params: Promise.resolve({ category: "fuel" }), searchParams: search({ year: "2026" }) }));
    expect(fuel).toContain("October"); expect(fuel).toContain("1 fill-up"); expect(fuel).toContain("Synthetic car one $30.00");
    expect(fuel).toContain('href="/reports?year=2026"');
  });
  it("returns a 404 for another or malformed car address or kind", async () => {
    for (const id of ["999", "bad", "../1"]) await expect(carPage(id)).rejects.toThrow("not-found");
    await expect(CarCostCategoryPage({ params: Promise.resolve({ id: "1", category: "snacks" }), searchParams: search() })).rejects.toThrow("not-found");
    await expect(CostCategoryPage({ params: Promise.resolve({ category: "service" }), searchParams: search() })).rejects.toThrow("not-found");
  });
  it("uses fresh records on repeat requests rather than preserving stale totals", async () => {
    expect(await html(carPage("1", { year: "2026" }))).toContain("$30");
    connection.db.update(fuelRecords).set({ totalCents: 4500 }).run();
    const updated = await html(carPage("1", { year: "2026" }));
    expect(updated).toContain("$45"); expect(updated).not.toContain(">$30<");
  });
  it("provides failure/retry and loading states without rendering made-up totals", () => {
    const reset = vi.fn();
    const page = renderToStaticMarkup(createElement(ReportError, { error: new Error("synthetic"), reset }));
    expect(page).toContain("Try again"); expect(page).not.toContain("$0");
    const tree = ReportError({ error: new Error("synthetic"), reset });
    const button = tree.props.children.find((child: { type?: string }) => child.type === "button");
    button.props.onClick(); expect(reset).toHaveBeenCalledOnce();
    expect(renderToStaticMarkup(createElement(ReportsLoading))).toContain('aria-busy="true"');
  });
});

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database";
import { cars } from "@/lib/schema";
import { deleteService, saveService } from "@/lib/services";
import { completeMaintenance, maintenanceFromForm, saveMaintenance } from "@/lib/maintenance";
import { dotMadeOn, parseDot, tireFromForm, treadFromForm, type TireInput } from "@/lib/tire-input";
import {
  addTires, deleteTire, getTire, lastFitted, projectTread, setTread, tireAge, tireSets, tireSummary, treadChecks, treadFor, updateTire,
  type TreadCheck,
} from "@/lib/tires";

process.env.TZ_NAME = "America/Chicago";
const NOW = Date.UTC(2026, 9, 26, 17);
const connections: ReturnType<typeof openDatabase>[] = [];
const fresh = () => {
  const connection = openDatabase(":memory:"); connections.push(connection);
  connection.db.insert(cars).values({ id: 1, nickname: "Synthetic car", createdAt: NOW, updatedAt: NOW }).run();
  connection.db.insert(cars).values({ id: 2, nickname: "Other synthetic car", createdAt: NOW, updatedAt: NOW }).run();
  return connection.db;
};
afterEach(() => { for (const { sqlite } of connections.splice(0)) sqlite.close(); });
const tire = (changes: Partial<TireInput> = {}): TireInput => ({
  position: null, brand: "Synthetic", model: "All Season", size: "225/65R17", dot: null, installedDate: "2025-07-22", installedMiles: 32000,
  serviceId: null, removedDate: null, removedMiles: null, notes: null, ...changes,
});
const service = (db: ReturnType<typeof fresh>, changes: Partial<Parameters<typeof saveService>[2]> = {}, carId = 1) =>
  saveService(db, carId, { kind: "service", title: "Tread check", date: "2026-04-01", shop: null, miles: 40000, totalCents: null, lineItems: [], notes: null, ...changes },
    { requestKey: randomUUID(), now: NOW });
const form = (entries: [string, string][]) => { const data = new FormData(); for (const [k, v] of entries) data.append(k, v); return data; };
const check = (date: string, miles: number | null, lowest: number): TreadCheck =>
  ({ serviceId: 1, title: "Tread check", date, miles, tread: { lf: lowest, rf: lowest + 1, lr: null, rr: lowest + 1 }, lowest });

describe("tire history", () => {
  it("keeps one tire per position: new tires take the old ones off on the install day", () => {
    const db = fresh();
    addTires(db, 1, tire({ installedDate: "2022-02-23", installedMiles: 7, brand: "Original" }), ["lf", "rf", "lr", "rr"], { requestKey: randomUUID(), now: NOW });
    const key = randomUUID();
    const added = addTires(db, 1, tire(), ["lr", "rr"], { requestKey: key, now: NOW });
    expect(addTires(db, 1, tire(), ["lr", "rr"], { requestKey: key, now: NOW }).map((t) => t.id)).toEqual(added.map((t) => t.id));
    const { current, past } = tireSets(db, 1);
    expect(current.map((t) => [t.position, t.brand])).toEqual([["lf", "Original"], ["rf", "Original"], ["lr", "Synthetic"], ["rr", "Synthetic"]]);
    expect(past.map((t) => [t.position, t.removedDate, t.removedMiles])).toEqual([["lr", "2025-07-22", 32000], ["rr", "2025-07-22", 32000]]);
    expect(lastFitted(current)).toBe("2025-07-22");
    expect(tireSets(db, 2).current).toEqual([]);
  });

  it("does not take off a tire fitted after a backdated entry, or tires of unknown position", () => {
    const db = fresh();
    addTires(db, 1, tire({ installedDate: "2025-07-22" }), ["lf", null], { requestKey: randomUUID(), now: NOW });
    addTires(db, 1, tire({ installedDate: "2019-05-10", brand: "Older" }), ["lf", null], { requestKey: randomUUID(), now: NOW });
    expect(tireSets(db, 1).current).toHaveLength(4);
  });

  it("validates dates, mileage and the linked service, and guards edits by revision", () => {
    const db = fresh();
    const [saved] = addTires(db, 1, tire(), ["lf"], { requestKey: randomUUID(), now: NOW });
    expect(() => updateTire(db, 1, saved.id, saved.revision, tire({ removedDate: "2025-01-01" }), NOW)).toThrow("can't come off before");
    expect(() => updateTire(db, 1, saved.id, saved.revision, tire({ removedMiles: 100 }), NOW)).toThrow("at or above");
    expect(() => addTires(db, 1, tire({ installedDate: "2026-12-01" }), ["rf"], { requestKey: randomUUID(), now: NOW })).toThrow("up to today");
    const other = service(db, {}, 2);
    expect(() => addTires(db, 1, tire({ serviceId: other.id }), ["rf"], { requestKey: randomUUID(), now: NOW })).toThrow("this car");
    const removed = updateTire(db, 1, saved.id, saved.revision, tire({ removedDate: "2026-10-01", removedMiles: 49000 }), NOW);
    expect(removed).toMatchObject({ revision: 2, removedDate: "2026-10-01" });
    expect(() => updateTire(db, 1, saved.id, 1, tire(), NOW)).toThrow("another window");
    deleteTire(db, 1, saved.id, 2);
    expect(getTire(db, 1, saved.id)).toBeNull();
  });

  it("reads the add and edit forms", () => {
    const added = tireFromForm(form([["adding", "1"], ["positions", "lr"], ["positions", "rr"], ["positions", "bogus"], ["dot", "DOT 4B9X ABC 2324"],
      ["installedDate", "2025-07-22"], ["installedMiles", "32,275"], ["serviceId", ""], ["brand", " Yokohama "]]), NOW);
    expect(added).toMatchObject({ ok: true, positions: ["lr", "rr"], input: { dot: "2324", installedMiles: 32275, brand: "Yokohama", model: null, removedDate: null } });
    expect(tireFromForm(form([["adding", "1"], ["installedDate", "2025-07-22"]]), NOW)).toMatchObject({ ok: false, errors: { positions: expect.any(String) } });
    expect(tireFromForm(form([["position", ""], ["installedDate", "2025-07-22"], ["dot", "9924"]]), NOW)).toMatchObject({ ok: false, errors: { dot: expect.any(String) } });
    expect(tireFromForm(form([["position", ""], ["installedDate", "2025-07-22"], ["removedDate", "2026-01-01"]]), NOW))
      .toMatchObject({ ok: true, positions: [null], input: { position: null, removedDate: "2026-01-01" } });
  });

  it("dates tires by DOT code and warns at six years", () => {
    expect(parseDot("23/24")).toBe("2324");
    expect(parseDot("")).toBeNull();
    expect(parseDot("abc")).toBeUndefined();
    expect(dotMadeOn("0119", "2026-10-26")).toBe("2019-01-01");
    expect(dotMadeOn("2324", "2026-10-26")).toBe("2024-06-03");
    expect(tireAge({ dot: "0119", installedDate: "2019-05-10" }, "2026-10-26")).toMatchObject({ kind: "dot", old: true });
    expect(tireAge({ dot: "2324", installedDate: "2025-07-22" }, "2026-10-26")).toMatchObject({ kind: "dot", old: false });
    expect(tireAge({ dot: null, installedDate: "2025-07-22" }, "2026-10-26")).toMatchObject({ kind: "installed" });
  });
});

describe("tread depth", () => {
  it("reads 32nds from the four boxes; all blank is no reading", () => {
    expect(treadFromForm(form([["tread.lf", "9"], ["tread.rf", "9/32"], ["tread.lr", " 10 / 32"], ["tread.rr", ""]])))
      .toEqual({ ok: true, tread: { lf: 9, rf: 9, lr: 10, rr: null } });
    expect(treadFromForm(form([]))).toEqual({ ok: true, tread: null });
    expect(treadFromForm(form([["tread.lf", "9.5"], ["tread.rr", "33"]]))).toMatchObject({ ok: false, errors: { "tread.lf": expect.any(String), "tread.rr": expect.any(String) } });
  });

  it("keeps readings with completed service only and drops them with the record", () => {
    const db = fresh();
    const done = service(db);
    setTread(db, 1, done.id, { lf: 9, rf: 9, lr: 10, rr: 10 });
    expect(treadFor(db, done.id)).toEqual({ lf: 9, rf: 9, lr: 10, rr: 10 });
    const quote = service(db, { kind: "quote" });
    setTread(db, 1, quote.id, { lf: 5, rf: 5, lr: 5, rr: 5 });
    expect(treadFor(db, quote.id)).toBeNull();
    expect(treadChecks(db, 1).map((c) => c.lowest)).toEqual([9]);
    setTread(db, 1, done.id, null);
    expect(treadFor(db, done.id)).toBeNull();
    setTread(db, 1, done.id, { lf: 8, rf: null, lr: null, rr: null });
    deleteService(db, 1, done.id, done.revision);
    expect(treadChecks(db, 1)).toEqual([]);
  });

  it("saves tread depths with Mark done when the schedule asks for them", () => {
    const db = fresh();
    const parsed = maintenanceFromForm(form([["title", "Tread check"], ["intervalMonths", "3"], ["baselineDate", "2026-07-01"], ["enabled", "on"], ["asksTread", "on"]]), NOW);
    expect(parsed).toMatchObject({ ok: true, input: { asksTread: true } });
    const schedule = saveMaintenance(db, 1, (parsed as { ok: true; input: Parameters<typeof saveMaintenance>[2] }).input, { requestKey: randomUUID(), now: NOW });
    expect(schedule.asksTread).toBe(true);
    const { service: work } = completeMaintenance(db, 1, schedule.id, schedule.revision,
      { kind: "service", title: "Tread check", date: "2026-10-26", shop: "DIY", miles: 49800, totalCents: 0, lineItems: [], notes: null },
      { requestKey: randomUUID(), now: NOW, tread: { lf: 8, rf: 8, lr: 9, rr: 9 } });
    expect(treadFor(db, work.id)).toEqual({ lf: 8, rf: 8, lr: 9, rr: 9 });
    expect(tireSummary(db, 1, NOW)).toMatchObject({ treadSchedule: { id: schedule.id }, projection: { kind: "need-more" } });
  });

  it("projects when the worst tire reaches 4/32 from checks since tires were fitted", () => {
    expect(projectTread([], null, 20)).toEqual({ kind: "none" });
    expect(projectTread([check("2026-01-01", 40000, 4)], null, 20)).toMatchObject({ kind: "replace-now" });
    expect(projectTread([check("2026-01-01", 40000, 9)], null, 20)).toMatchObject({ kind: "need-more" });
    expect(projectTread([check("2026-01-01", 40000, 9), check("2026-02-01", 40500, 9)], null, 20)).toMatchObject({ kind: "need-more" });
    expect(projectTread([check("2026-01-01", 40000, 9), check("2026-04-01", 42000, 9)], null, 20)).toMatchObject({ kind: "steady" });
    // 9/32 at 40,000 and 8/32 at 45,000: 1/32 every 5,000 miles, 4/32 left is 20,000 miles; at 20 a day that's 1,000 days.
    const projected = projectTread([check("2026-01-01", 40000, 9), check("2026-07-01", 45000, 8)], null, 20);
    expect(projected).toMatchObject({ kind: "projected", milesLeft: 20000, atMiles: 65000, date: "2029-03-27" });
    expect((projected as { wearPer10k: number }).wearPer10k).toBeCloseTo(2);
    expect(projectTread([check("2026-01-01", 40000, 9), check("2026-07-01", 45000, 8)], null, null)).toMatchObject({ kind: "projected", date: null });
    // Wear on the old tires doesn't count once new ones go on.
    expect(projectTread([check("2025-01-01", 30000, 5), check("2026-01-01", 40000, 10), check("2026-07-01", 45000, 9)], "2025-07-22", 20))
      .toMatchObject({ kind: "projected", milesLeft: 25000 });
  });
});

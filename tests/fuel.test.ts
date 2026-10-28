import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database";
import { cars } from "@/lib/schema";
import { addReading, readingsFor } from "@/lib/cars";
import { calculateMpg, type MpgFill } from "@/lib/fuel-mpg";
import { deleteFuel, fuelFor, getFuel, saveFuel } from "@/lib/fuel";
import { fuelFromForm, fuelInputSchema, fuelMoneyInput, fuelMoneyValue, gallonsInput, gallonsValue, type FuelInput } from "@/lib/fuel-input";
import { fuelFormInitial } from "@/lib/fuel-page";

process.env.TZ_NAME = "America/Chicago";
const NOW = Date.UTC(2026, 9, 26, 17);
const connections: Database.Database[] = [];
const fresh = () => { const connection = openDatabase(":memory:"); connections.push(connection.sqlite); return connection; };
const makeCar = (db: ReturnType<typeof openDatabase>["db"], nickname = "Synthetic car") => db.insert(cars).values({ nickname, createdAt: NOW, updatedAt: NOW }).returning().get();
const input = (changes: Partial<FuelInput> = {}): FuelInput => ({ date: "2026-10-10", miles: 10000, gallonsMilli: 10000, totalCents: 3029, fullTank: true, missedFillups: false, notes: null, ...changes });
const save = (db: ReturnType<typeof openDatabase>["db"], carId: number, changes: Partial<FuelInput> = {}, options: Partial<Parameters<typeof saveFuel>[3]> = {}) => saveFuel(db, carId, input(changes), { requestKey: randomUUID(), now: NOW, ...options });
const fill = (id: number, changes: Partial<MpgFill> = {}): MpgFill => ({ id, carId: 1, date: `2026-10-${String(id).padStart(2, "0")}`, miles: id * 300, gallonsMilli: 10000, fullTank: true, missedFillups: false, ...changes });
const form = (changes: Record<string, string | null> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ date: "2026-10-10", miles: "47,950", gallonsMilli: "12.345", totalCents: "42.19", fullTank: "on", notes: "", ...changes })) if (value !== null) data.set(key, value);
  return data;
};
afterEach(() => { for (const connection of connections.splice(0)) connection.close(); });

describe("fuel exact form values", () => {
  it("parses gallons and dollars by exact decimal digits", () => {
    expect(gallonsInput.parse("12.345")).toBe(12345);
    expect(gallonsInput.parse("0.001")).toBe(1);
    expect(gallonsInput.parse("1.1")).toBe(1100);
    expect(fuelMoneyInput.parse("$1,234.56")).toBe(123456);
    expect(fuelMoneyInput.parse("0.29")).toBe(29);
    expect(fuelMoneyInput.parse("0")).toBe(0);
    for (const value of ["", "0", "-1", "1.2345", "1e2", "1,23", "NaN", "1000.001"]) expect(gallonsInput.safeParse(value).success, value).toBe(false);
    for (const value of ["", "-1", "1.005", "1e2", "1,23", "Infinity", "10000000.01"]) expect(fuelMoneyInput.safeParse(value).success, value).toBe(false);
    for (const milli of [1, 29, 1000, 12345, 1_000_000]) expect(gallonsInput.parse(gallonsValue(milli))).toBe(milli);
    for (const cents of [0, 1, 29, 4219, 1_000_000_000]) expect(fuelMoneyInput.parse(fuelMoneyValue(cents))).toBe(cents);
  });
  it("distinguishes required unknown values from valid zero and false", () => {
    expect(fuelFromForm(form({ miles: "0", totalCents: "0", fullTank: null }), NOW)).toMatchObject({ ok: true, input: { miles: 0, totalCents: 0, fullTank: false, missedFillups: false, notes: null } });
    expect(fuelFromForm(form({ miles: "", gallonsMilli: "", totalCents: "" }), NOW)).toMatchObject({ ok: false, errors: { miles: expect.any(String), gallonsMilli: expect.any(String), totalCents: expect.any(String) } });
    expect(fuelInputSchema.safeParse(input({ miles: null as unknown as number })).success).toBe(false);
    expect(fuelInputSchema.safeParse(input({ totalCents: NaN })).success).toBe(false);
  });
  it("rejects impossible/future dates and malformed readings or options", () => {
    for (const date of ["2026-02-29", "2026-04-31", "2026-10-27", "1899-12-31", "2026-1-01", ""]) expect(fuelFromForm(form({ date }), NOW).ok, date).toBe(false);
    expect(fuelFromForm(form({ date: "2024-02-29" }), NOW).ok).toBe(true);
    for (const miles of ["-1", "1.5", "2e4", "1,23", "2000001"]) expect(fuelFromForm(form({ miles }), NOW).ok).toBe(false);
    expect(fuelFromForm(form({ fullTank: "false" }), NOW)).toMatchObject({ ok: false, errors: { fullTank: expect.any(String) } });
  });
  it("round-trips existing zero and false values to the edit form", () => {
    const { db } = fresh(); const car = makeCar(db);
    const record = save(db, car.id, { miles: 0, totalCents: 0, fullTank: false });
    expect(fuelFormInitial("2026-10-26", record.requestKey, record)).toMatchObject({ date: "2026-10-10", miles: "0", totalCents: "0.00", gallonsMilli: "10.000", fullTank: false, notes: "", revision: 1 });
  });
});

describe("pure full-tank MPG", () => {
  it("keeps the first full tank unknown and excludes its gallons from the next interval", () => {
    const result = calculateMpg([fill(1, { gallonsMilli: 20000 }), fill(2)]);
    expect(result[0]).toMatchObject({ id: 2, mpg: 30, intervalMiles: 300, gallonsMilli: 10000, anchorId: 1 });
    expect(result[1]).toMatchObject({ id: 1, mpg: null, reason: "first-full" });
  });
  it("includes every partial fill and the ending full tank", () => {
    const records = [fill(1), fill(2, { fullTank: false, gallonsMilli: 5000 }), fill(3, { fullTank: false, gallonsMilli: 5000 }), fill(4)];
    expect(calculateMpg(records)[0]).toMatchObject({ mpg: 45, intervalMiles: 900, gallonsMilli: 20000 });
    expect(calculateMpg(records)[1]).toMatchObject({ mpg: null, reason: "partial" });
  });
  it("does not use unanchored partial fuel in a later full-tank interval", () => {
    const records = [fill(1, { fullTank: false, gallonsMilli: 20000 }), fill(2), fill(3)];
    expect(calculateMpg(records).map((result) => result.mpg)).toEqual([30, null, null]);
    expect(calculateMpg(records).at(-1)?.reason).toBe("no-anchor");
  });
  it("breaks an interval at a missed partial fill, then starts over at a full tank", () => {
    const records = [fill(1), fill(2, { fullTank: false, missedFillups: true }), fill(3), fill(4)];
    const result = calculateMpg(records);
    expect(result.map((r) => r.mpg)).toEqual([30, null, null, null]);
    expect(result.find((r) => r.id === 3)?.reason).toBe("missed-fill");
  });
  it("a missed full fill itself is a fresh anchor", () => {
    expect(calculateMpg([fill(1), fill(2, { missedFillups: true }), fill(3)]).map((r) => r.mpg)).toEqual([30, null, null]);
  });
  it("orders same-day records by mileage without mutating input", () => {
    const records = [fill(3, { date: "2026-10-10" }), fill(1, { date: "2026-10-10" }), fill(2, { date: "2026-10-10", fullTank: false })];
    expect(calculateMpg(records)[0]).toMatchObject({ id: 3, mpg: 30, gallonsMilli: 20000 });
    expect(records.map((record) => record.id)).toEqual([3, 1, 2]);
    expect(calculateMpg([fill(1), fill(2, { miles: 300 })])[0]).toMatchObject({ mpg: null, reason: "no-distance" });
  });
  it("isolates each car even when passed interleaved household records", () => {
    const result = calculateMpg([fill(1), fill(2, { carId: 2, miles: 90000, missedFillups: true }), fill(3, { miles: 600 }), fill(4, { carId: 2, miles: 90100 })]);
    expect(result.find((r) => r.id === 3)?.mpg).toBe(30);
    expect(result.find((r) => r.id === 4)?.mpg).toBe(10);
    expect(calculateMpg([])).toEqual([]);
  });
});

describe("transactional car-linked fuel", () => {
  it("scopes records, retry keys and owned readings to their car", () => {
    const { db } = fresh(); const car = makeCar(db); const other = makeCar(db, "Other");
    const record = save(db, car.id);
    save(db, other.id, { miles: 80000 });
    expect(fuelFor(db, car.id)).toEqual([record]);
    expect(getFuel(db, other.id, record.id)).toBeNull();
    expect(() => save(db, other.id, {}, { id: record.id, revision: record.revision })).toThrow(/deleted/);
    expect(() => save(db, other.id, {}, { requestKey: record.requestKey })).toThrow(/different fill-up/);
    deleteFuel(db, other.id, record.id, 1);
    expect(getFuel(db, car.id, record.id)).toEqual(record);
    expect(readingsFor(db, other.id)).toMatchObject([{ miles: 80000 }]);
  });
  it("preserves later same-day readings and accepts same-day fill-ups in odometer order", () => {
    const { db } = fresh(); const car = makeCar(db);
    addReading(db, { carId: car.id, miles: 12000, readAt: NOW, source: "manual" }, NOW);
    const high = save(db, car.id, { date: "2026-10-26", miles: 11500 });
    const low = save(db, car.id, { date: "2026-10-26", miles: 11000 });
    expect(fuelFor(db, car.id).map((record) => record.id)).toEqual([high.id, low.id]);
    expect(readingsFor(db, car.id).map((reading) => reading.miles)).toEqual([12000, 11500, 11000]);
    expect(calculateMpg(fuelFor(db, car.id))[0].mpg).toBe(50);
    expect(() => save(db, car.id, { date: "2026-10-25", miles: 13000 })).toThrow(/later/);
  });
  it("rolls back invalid create and edit, preserving the prior mileage and record", () => {
    const { db } = fresh(); const car = makeCar(db);
    addReading(db, { carId: car.id, miles: 20000, readAt: NOW, source: "manual" }, NOW);
    expect(() => save(db, car.id, { miles: 25000 })).toThrow(/later/);
    expect(fuelFor(db, car.id)).toEqual([]);
    const record = save(db, car.id);
    const readings = readingsFor(db, car.id);
    expect(() => save(db, car.id, { miles: 25000, totalCents: 9999 }, { id: record.id, revision: 1 })).toThrow(/later/);
    expect(getFuel(db, car.id, record.id)).toEqual(record);
    expect(readingsFor(db, car.id)).toEqual(readings);
  });
  it("allows repeated same-day entry and backfill between fills with one shared request time", () => {
    const { db } = fresh(); const car = makeCar(db);
    save(db, car.id, { date: "2026-10-26", miles: 10000 });
    save(db, car.id, { date: "2026-10-26", miles: 10600 });
    save(db, car.id, { date: "2026-10-26", miles: 10300, fullTank: false });
    expect(readingsFor(db, car.id).map((record) => record.miles)).toEqual([10600, 10300, 10000]);
    expect(calculateMpg(fuelFor(db, car.id))[0].mpg).toBe(30);
    const earliest = fuelFor(db, car.id).at(-1)!;
    save(db, car.id, { date: "2026-10-26", miles: 10100 }, { id: earliest.id, revision: earliest.revision, requestKey: earliest.requestKey });
    expect(readingsFor(db, car.id).map((record) => record.miles)).toEqual([10600, 10300, 10100]);
  });
  it("composes inside an outer transaction and rolls back all effects together", () => {
    const { db } = fresh(); const car = makeCar(db);
    expect(() => db.transaction((tx) => { saveFuel(tx, car.id, input(), { requestKey: randomUUID(), now: NOW }); throw new Error("outer rollback"); })).toThrow("outer rollback");
    expect(fuelFor(db, car.id)).toEqual([]); expect(readingsFor(db, car.id)).toEqual([]);
    const record = save(db, car.id);
    expect(() => db.transaction((tx) => { deleteFuel(tx, car.id, record.id, 1); throw new Error("outer rollback"); })).toThrow("outer rollback");
    expect(getFuel(db, car.id, record.id)).toEqual(record); expect(readingsFor(db, car.id)).toHaveLength(1);
  });
  it("recomputes MPG after editing and deleting partial fills", () => {
    const { db } = fresh(); const car = makeCar(db);
    save(db, car.id);
    let partial = save(db, car.id, { date: "2026-10-12", miles: 10100, fullTank: false, gallonsMilli: 5000 });
    save(db, car.id, { date: "2026-10-14", miles: 10400, gallonsMilli: 5000 });
    expect(calculateMpg(fuelFor(db, car.id))[0].mpg).toBe(40);
    partial = save(db, car.id, { date: partial.date, miles: 10100, fullTank: false, gallonsMilli: 15000 }, { id: partial.id, revision: 1 });
    expect(calculateMpg(fuelFor(db, car.id))[0].mpg).toBe(20);
    deleteFuel(db, car.id, partial.id, partial.revision);
    expect(calculateMpg(fuelFor(db, car.id))[0].mpg).toBe(80);
  });
  it("updates or deletes only the fill-up's own reading, even when source ids collide", () => {
    const { db } = fresh(); const car = makeCar(db);
    let record = save(db, car.id);
    addReading(db, { carId: car.id, miles: 12000, readAt: NOW, source: "service", sourceId: record.id }, NOW);
    addReading(db, { carId: car.id, miles: 12000, readAt: NOW, source: "manual", sourceId: record.id }, NOW);
    record = save(db, car.id, { miles: 11000 }, { id: record.id, revision: 1 });
    expect(readingsFor(db, car.id).filter((reading) => reading.source === "fill-up")).toMatchObject([{ miles: 11000, sourceId: record.id }]);
    deleteFuel(db, car.id, record.id, record.revision);
    deleteFuel(db, car.id, record.id, record.revision);
    expect(readingsFor(db, car.id).map((reading) => reading.source).sort()).toEqual(["manual", "service"]);
    const replacement = save(db, car.id);
    expect(replacement.id).toBeGreaterThan(record.id);
    deleteFuel(db, car.id, record.id, record.revision);
    expect(getFuel(db, car.id, replacement.id)).toEqual(replacement);
  });
  it("recomputes broken intervals after editing a missed-fill flag or deleting an anchor", () => {
    const { db } = fresh(); const car = makeCar(db);
    const anchor = save(db, car.id);
    let middle = save(db, car.id, { date: "2026-10-12", miles: 10100, missedFillups: true });
    save(db, car.id, { date: "2026-10-14", miles: 10400 });
    expect(calculateMpg(fuelFor(db, car.id)).map((result) => result.mpg)).toEqual([30, null, null]);
    middle = save(db, car.id, { date: middle.date, miles: middle.miles, missedFillups: false }, { id: middle.id, revision: middle.revision, requestKey: middle.requestKey });
    expect(calculateMpg(fuelFor(db, car.id)).find((result) => result.id === middle.id)?.mpg).toBe(10);
    deleteFuel(db, car.id, anchor.id, anchor.revision);
    expect(calculateMpg(fuelFor(db, car.id)).find((result) => result.id === middle.id)?.mpg).toBeNull();
    expect(calculateMpg(fuelFor(db, car.id))[0].mpg).toBe(30);
  });
  it("makes create and edit retries idempotent and refuses changed retry payloads", () => {
    const { db } = fresh(); const car = makeCar(db); const requestKey = randomUUID();
    const record = save(db, car.id, {}, { requestKey });
    expect(save(db, car.id, {}, { requestKey })).toEqual(record);
    expect(() => save(db, car.id, { totalCents: 99 }, { requestKey })).toThrow(/different fill-up/);
    const options = { id: record.id, revision: record.revision, requestKey };
    const edited = save(db, car.id, { totalCents: 0 }, options);
    expect(save(db, car.id, { totalCents: 0 }, options)).toEqual(edited);
    expect(fuelFor(db, car.id)).toHaveLength(1); expect(readingsFor(db, car.id)).toHaveLength(1);
    expect(() => save(db, car.id, { notes: "Stale change" }, options)).toThrow(/another window/);
    expect(() => deleteFuel(db, car.id, record.id, 1)).toThrow(/changed/);
    expect(getFuel(db, car.id, record.id)).toEqual(edited);
  });
  it("rejects invalid normalized inputs, future fills and missing cars without writing", () => {
    const { db } = fresh(); const car = makeCar(db);
    expect(() => save(db, car.id, { gallonsMilli: 1.5 })).toThrow();
    expect(() => save(db, car.id, { totalCents: -1 })).toThrow();
    expect(() => save(db, car.id, { date: "2026-10-27" })).toThrow(/future/);
    expect(() => save(db, 999)).toThrow(/no longer/);
    expect(fuelFor(db, car.id)).toEqual([]); expect(readingsFor(db, car.id)).toEqual([]);
  });
});

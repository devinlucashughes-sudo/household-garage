import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { addReading, readingsFor } from "@/lib/cars";
import { openDatabase } from "./database";
import { cars, importDrafts, serviceRecords } from "@/lib/schema";
import { deleteService, getService, saveService } from "@/lib/services";
import {
  addCalendarMonths, calculateMaintenanceDue, deleteMaintenance, getMaintenance, householdMaintenanceDue,
  maintenanceDueFor, maintenanceFor, maintenanceFromForm, maintenanceInputSchema, saveMaintenance,
  type MaintenanceInput, type MaintenanceSchedule,
} from "@/lib/maintenance";

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
const input = (changes: Partial<MaintenanceInput> = {}): MaintenanceInput => ({
  title: "Oil and filter", intervalMiles: 5000, intervalMonths: 6, baselineDate: "2026-04-30", baselineMiles: 10000,
  lastServiceId: null, enabled: true, notes: null, ...changes,
});
const save = (db: ReturnType<typeof fresh>, changes: Partial<MaintenanceInput> = {}, options: Partial<Parameters<typeof saveMaintenance>[3]> = {}, carId = 1) =>
  saveMaintenance(db, carId, input(changes), { requestKey: randomUUID(), now: NOW, ...options });
const schedule = (changes: Partial<MaintenanceSchedule> = {}): MaintenanceSchedule => ({
  ...input(), optional: false, asksTread: false, id: 1, carId: 1, sourceDraftId: null, revision: 1, requestKey: "synthetic", createdBy: null, createdAt: NOW, updatedAt: NOW, ...changes,
});
const due = (changes: Partial<MaintenanceSchedule> = {}, miles: number | null = 14000, today = "2026-10-01") =>
  calculateMaintenanceDue(schedule(changes), null, miles, today);
const service = (db: ReturnType<typeof fresh>, changes: Partial<Parameters<typeof saveService>[2]> = {}, carId = 1) =>
  saveService(db, carId, { kind: "service", title: "Completed synthetic work", date: "2026-04-01", shop: null, miles: 10000, totalCents: null, lineItems: [], notes: null, ...changes }, { requestKey: randomUUID(), now: NOW });

describe("normalized maintenance input and hand-entry parsing", () => {
  const form = (changes: Record<string, string> = {}) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ title: "Oil change", intervalMiles: "5,000", intervalMonths: "6", baselineDate: "", baselineMiles: "", lastServiceId: "", enabled: "on", notes: "", ...changes })) data.set(key, value);
    return data;
  };
  it("accepts numeric/null domain values and keeps empty distinct from zero", () => {
    expect(maintenanceInputSchema.parse(input({ baselineMiles: 0 }))).toMatchObject({ baselineMiles: 0 });
    expect(maintenanceFromForm(form(), NOW)).toMatchObject({ ok: true, input: { intervalMiles: 5000, baselineMiles: null, baselineDate: null, enabled: true, notes: null } });
    expect(maintenanceFromForm(form({ baselineMiles: "0", enabled: "" }), NOW)).toMatchObject({ ok: true, input: { baselineMiles: 0, enabled: false } });
    const optional = maintenanceFromForm(form({ optional: "on" }), NOW);
    expect(optional).toMatchObject({ ok: true, input: { optional: true } });
    const db = fresh();
    const saved = saveMaintenance(db, 1, (optional as { input: MaintenanceInput }).input, { requestKey: randomUUID(), now: NOW });
    expect(saved.optional).toBe(true);
    expect(save(db).optional).toBe(false);
    expect(maintenanceInputSchema.safeParse({ ...input(), intervalMiles: "5000" }).success).toBe(false);
    expect(maintenanceInputSchema.safeParse({ ...input(), enabled: "false" }).success).toBe(false);
  });
  it("requires at least one positive interval and rejects fractional, negative and malformed numbers", () => {
    const invalid: Record<string, string>[] = [{ intervalMiles: "", intervalMonths: "" }, { intervalMiles: "0" }, { intervalMonths: "0" }, { intervalMonths: "1.5" }, { baselineMiles: "-1" }, { intervalMiles: "NaN" }, { intervalMiles: "1,23" }, { intervalMiles: "2000001" }, { lastServiceId: "-1" }];
    for (const changes of invalid)
      expect(maintenanceFromForm(form(changes), NOW).ok).toBe(false);
    expect(maintenanceFromForm(form({ intervalMiles: "", intervalMonths: "1" }), NOW).ok).toBe(true);
    expect(maintenanceFromForm(form({ intervalMiles: "1", intervalMonths: "" }), NOW).ok).toBe(true);
    expect(maintenanceFromForm(form({ title: "  " }), NOW)).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
  });
  it("validates real calendar dates and future baselines in the household timezone", () => {
    for (const baselineDate of ["2026-02-29", "2026-04-31", "2026-10-27", "2026-1-01", "1899-01-01"])
      expect(maintenanceFromForm(form({ baselineDate }), NOW).ok).toBe(false);
    expect(maintenanceFromForm(form({ baselineDate: "2024-02-29" }), NOW).ok).toBe(true);
    expect(maintenanceFromForm(form({ baselineDate: "2026-10-26" }), NOW).ok).toBe(true);
    const db = fresh();
    expect(() => save(db, { baselineDate: "2026-10-27" })).toThrow(/up to today/);
    expect(maintenanceFor(db, 1)).toEqual([]);
  });
  it("clears manual baselines on linking and never trusts a source import from form or payload", () => {
    expect(maintenanceFromForm(form({ lastServiceId: "7", baselineDate: "bad", baselineMiles: "bad" }), NOW)).toMatchObject({ ok: true, input: { lastServiceId: 7, baselineDate: null, baselineMiles: null } });
    expect(maintenanceInputSchema.parse({ ...input({ lastServiceId: 7 }), sourceDraftId: "forged" })).toEqual(input({ lastServiceId: 7, baselineDate: null, baselineMiles: null }));
    const data = form(); data.set("sourceDraftId", "forged");
    const parsed = maintenanceFromForm(data, NOW);
    expect(parsed.ok && "sourceDraftId" in parsed.input).toBe(false);
  });
});

describe("calendar month and due calculations", () => {
  it("clamps month ends through common and leap years without date rollover", () => {
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addCalendarMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addCalendarMonths("2023-08-31", 6)).toBe("2024-02-29");
    expect(addCalendarMonths("2026-12-31", 2)).toBe("2027-02-28");
    expect(addCalendarMonths("2026-01-31", 2)).toBe("2026-03-31");
  });
  it("uses whichever known limit is reached first, including equality", () => {
    expect(due({}, 15000).state).toBe("overdue");
    expect(due({}, 10000, "2026-10-30").state).toBe("overdue");
    expect(due({}, 10000, "2026-10-31").state).toBe("overdue");
    expect(due({ baselineDate: null }, 15001).state).toBe("overdue");
    expect(due({ baselineMiles: null }, null, "2026-10-30").state).toBe("overdue");
  });
  it("uses inclusive 500-mile and 30-calendar-day due-soon limits", () => {
    expect(due({ intervalMonths: null }, 14500).state).toBe("due-soon");
    expect(due({ intervalMonths: null }, 14499).state).toBe("upcoming");
    expect(due({ intervalMiles: null }, null, "2026-09-30")).toMatchObject({ state: "due-soon", remainingDays: 30 });
    expect(due({ intervalMiles: null }, null, "2026-09-29")).toMatchObject({ state: "upcoming", remainingDays: 31 });
    expect(due({ baselineDate: "2026-02-08", intervalMonths: 1, intervalMiles: null }, null, "2026-03-07").remainingDays).toBe(1);
  });
  it("uses a known date or mileage independently and never manufactures an unknown value", () => {
    expect(due({ baselineDate: null, baselineMiles: null })).toMatchObject({ state: "needs-baseline", dueDate: null, dueMiles: null });
    expect(due({ intervalMonths: null }, null)).toMatchObject({ state: "needs-baseline", dueMiles: 15000, remainingMiles: null });
    expect(due({ baselineMiles: null }, null, "2026-10-01")).toMatchObject({ state: "due-soon", dueDate: "2026-10-30", dueMiles: null });
    expect(due({ baselineDate: null, baselineMiles: 0, intervalMonths: null }, 0)).toMatchObject({ state: "upcoming", dueMiles: 5000, remainingMiles: 5000 });
    const unknown = due({ intervalMonths: null }, null);
    expect(unknown.basis.join(" ")).toMatch(/Current mileage unknown/);
    expect(unknown.basis.join(" ")).toMatch(/500 miles or 30 days/);
  });
  it("never treats a disabled schedule as due, even past both limits", () => {
    const result = due({ enabled: false }, 99999, "2026-12-01");
    expect(result.state).toBeNull(); expect(result.basis.join(" ")).toMatch(/Disabled/);
  });
});

describe("maintenance persistence and live service baselines", () => {
  it("starts empty, scopes CRUD to each car and preserves every service and odometer row", () => {
    const db = fresh(); expect(maintenanceDueFor(db, 1, NOW)).toEqual([]);
    const completed = service(db);
    addReading(db, { carId: 1, miles: 12000, readAt: NOW, source: "manual" }, NOW);
    const beforeReadings = readingsFor(db, 1); const beforeService = getService(db, 1, completed.id);
    const record = save(db, { baselineMiles: 0 }); save(db, { title: "Other car task" }, {}, 2);
    expect(maintenanceFor(db, 1)).toHaveLength(1); expect(getMaintenance(db, 2, record.id)).toBeNull();
    const updated = save(db, { title: "Renamed", lastServiceId: completed.id }, { id: record.id, revision: record.revision, requestKey: record.requestKey });
    expect(updated).toMatchObject({ title: "Renamed", revision: 2, baselineDate: null, baselineMiles: null, lastServiceId: completed.id });
    deleteMaintenance(db, 2, updated.id, updated.revision); expect(getMaintenance(db, 1, updated.id)).not.toBeNull();
    deleteMaintenance(db, 1, updated.id, updated.revision); deleteMaintenance(db, 1, updated.id, updated.revision);
    expect(getMaintenance(db, 1, updated.id)).toBeNull();
    expect(readingsFor(db, 1)).toEqual(beforeReadings); expect(getService(db, 1, completed.id)).toEqual(beforeService);
  });
  it("rejects invalid, quote and cross-car links on both create and update atomically", () => {
    const db = fresh(); const quote = service(db, { kind: "quote" }); const other = service(db, {}, 2);
    const first = save(db);
    for (const lastServiceId of [99999, quote.id, other.id]) {
      expect(() => save(db, { lastServiceId })).toThrow(/completed service/);
      expect(() => save(db, { lastServiceId }, { id: first.id, revision: first.revision, requestKey: first.requestKey })).toThrow(/completed service/);
    }
    expect(maintenanceFor(db, 1)).toEqual([first]);
  });
  it("uses the linked service's current date and nullable mileage, ignoring manual fields", () => {
    const db = fresh(); const completed = service(db, { miles: null });
    save(db, { lastServiceId: completed.id, baselineDate: "2026-01-01", baselineMiles: 0 });
    expect(maintenanceDueFor(db, 1, NOW)[0]).toMatchObject({ baselineSource: "service", baselineDate: "2026-04-01", baselineMiles: null, dueDate: "2026-10-01", dueMiles: null, state: "overdue" });
    saveService(db, 1, { kind: "service", title: completed.title, date: "2026-09-30", shop: null, miles: 20000, totalCents: null, lineItems: [], notes: null },
      { id: completed.id, revision: completed.revision, requestKey: completed.requestKey, now: NOW });
    expect(maintenanceDueFor(db, 1, NOW)[0]).toMatchObject({ baselineDate: "2026-09-30", baselineMiles: 20000, dueDate: "2027-03-30", dueMiles: 25000, state: "upcoming" });
    expect(maintenanceDueFor(db, 1, NOW)[0].basis.join(" ")).toMatch(/completed service/);
  });
  it("stops using a linked record converted to a quote and needs a new baseline after deletion", () => {
    const db = fresh(); const completed = service(db);
    const record = save(db, { lastServiceId: completed.id });
    db.update(serviceRecords).set({ kind: "quote" }).where(eq(serviceRecords.id, completed.id)).run();
    expect(maintenanceDueFor(db, 1, NOW)[0]).toMatchObject({ baselineSource: "unavailable-service", state: "needs-baseline", dueDate: null, dueMiles: null });
    deleteService(db, 1, completed.id, completed.revision);
    expect(getMaintenance(db, 1, record.id)).toMatchObject({ lastServiceId: null, baselineMiles: null, baselineDate: null });
    expect(maintenanceDueFor(db, 1, NOW)[0].state).toBe("needs-baseline");
  });
  it("rejects stale edits and deletes while accepting an exact retry only once", () => {
    const db = fresh(); const first = save(db);
    const options = { id: first.id, revision: first.revision, requestKey: first.requestKey };
    const updated = save(db, { notes: "Updated notes" }, options);
    expect(save(db, { notes: "Updated notes" }, options)).toEqual(updated);
    expect(() => save(db, { notes: "Stale tab" }, options)).toThrow(/another window/);
    expect(() => deleteMaintenance(db, 1, first.id, first.revision)).toThrow(/changed/);
    expect(getMaintenance(db, 1, first.id)).toEqual(updated);
  });
  it("deduplicates a create retry and refuses changed entries or another car with the same key", () => {
    const db = fresh(); const requestKey = randomUUID(); const first = save(db, {}, { requestKey });
    expect(save(db, {}, { requestKey })).toEqual(first);
    expect(() => save(db, { title: "Changed payload" }, { requestKey })).toThrow(/different entries/);
    expect(() => save(db, {}, { requestKey }, 2)).toThrow(/different entries/);
    expect(maintenanceFor(db, 1)).toHaveLength(1);
    expect(() => save(db, {}, { id: first.id, revision: 1, requestKey }, 2)).toThrow(/deleted/);
  });
  it("composes in an import transaction, rolls back with it, and takes provenance only from options", () => {
    const db = fresh(); const draftId = randomUUID();
    db.insert(importDrafts).values({ id: draftId, carId: 1, type: "maintenance", payload: "{}", payloadHash: "synthetic", idempotencyKey: randomUUID(), createdAt: NOW, updatedAt: NOW }).run();
    expect(() => db.transaction((tx) => {
      saveMaintenance(tx, 1, input(), { requestKey: randomUUID(), sourceDraftId: draftId, now: NOW });
      throw new Error("Synthetic approval rollback");
    })).toThrow(/rollback/);
    expect(maintenanceFor(db, 1)).toEqual([]);
    const first = db.transaction((tx) => saveMaintenance(tx, 1, input(), { requestKey: randomUUID(), sourceDraftId: draftId, now: NOW }));
    expect(first.sourceDraftId).toBe(draftId);
    const edited = save(db, { notes: "Manual correction" }, { id: first.id, revision: first.revision, requestKey: first.requestKey });
    expect(edited.sourceDraftId).toBe(draftId);
    expect(() => save(db, {}, { sourceDraftId: draftId }, 2)).toThrow(/source import/);
    expect(() => save(db, {}, { sourceDraftId: "missing" })).toThrow(/source import/);
  });
  it("excludes disabled schedules from the household due list and identifies estimated mileage", () => {
    const db = fresh(); save(db, { enabled: false, title: "Disabled task" });
    save(db, { intervalMonths: null, title: "Unknown current mileage" });
    expect(householdMaintenanceDue(db, NOW).map(({ due }) => due.schedule.title)).toEqual(["Unknown current mileage"]);
    addReading(db, { carId: 1, miles: 14000, readAt: NOW - 10 * 86400000, source: "manual" }, NOW);
    addReading(db, { carId: 1, miles: 14500, readAt: NOW - 3 * 86400000, source: "manual" }, NOW);
    const item = householdMaintenanceDue(db, NOW)[0];
    expect(item.due.state).toBe("due-soon"); expect(item.due.basis.join(" ")).toMatch(/Mileage Clock estimate/);
    expect(item.due.currentMiles).toBe(14714);
  });
  it("never reuses deleted schedule IDs or overwrites records through stale controls", () => {
    const db = fresh(); const first = save(db); deleteMaintenance(db, 1, first.id, first.revision);
    const second = save(db, { title: "Replacement" }); expect(second.id).toBeGreaterThan(first.id);
    expect(() => save(db, {}, { id: first.id, revision: 1 })).toThrow(/deleted/);
    deleteMaintenance(db, 1, first.id, 1); expect(getMaintenance(db, 1, second.id)?.title).toBe("Replacement");
    expect(() => save(db, {}, {}, 9999)).toThrow(/no longer/);
  });
});

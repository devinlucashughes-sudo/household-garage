import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "./database";
import { cars, importDrafts } from "@/lib/schema";
import { getMaintenance, householdMaintenanceDue, maintenanceFor, saveMaintenance, type MaintenanceInput } from "@/lib/maintenance";
import { saveService } from "@/lib/services";
import { maintenanceFromParams } from "@/lib/maintenance-page";
import { maintenanceAttempt } from "@/lib/maintenance-client";

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/lib/session", () => ({ requireUser: async () => {
  if (!auth.signedIn) throw new Error("SIGN_IN_REQUIRED");
  return { id: 1 };
} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  unstable_rethrow: (error: unknown) => { if (error instanceof Error && /^(?:REDIRECT:|NOT_FOUND)/.test(error.message)) throw error; },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  return { ...real, getDatabase: () => connection.db };
});
import { deleteMaintenanceAction, saveMaintenanceAction } from "@/app/maintenance-actions";
import MaintenancePage from "@/app/(garage)/maintenance/page";
import CarMaintenancePage from "@/app/(garage)/cars/[id]/maintenance/page";
import NewMaintenancePage from "@/app/(garage)/cars/[id]/maintenance/new/page";
import MaintenanceDetailPage from "@/app/(garage)/cars/[id]/maintenance/[maintenanceId]/page";
import EditMaintenancePage from "@/app/(garage)/cars/[id]/maintenance/[maintenanceId]/edit/page";
import { LedgerList } from "@/components/maintenance-ledger";
import { groupLedger } from "@/lib/maintenance-ledger";

let connection: ReturnType<typeof openDatabase>;
const NOW = Date.UTC(2026, 9, 26, 17);
const input: MaintenanceInput = { title: "Synthetic oil change", intervalMiles: null, intervalMonths: 6, baselineDate: "2026-01-01", baselineMiles: null, lastServiceId: null, enabled: true, notes: null };
const save = (changes: Partial<MaintenanceInput> = {}) => saveMaintenance(connection.db, 1, { ...input, ...changes }, { requestKey: randomUUID(), now: NOW });
const form = (changes: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ title: "New synthetic schedule", intervalMiles: "5000", intervalMonths: "", baselineDate: "", baselineMiles: "0", lastServiceId: "", enabled: "on", notes: "", requestKey: randomUUID(), ...changes })) data.set(key, value);
  return data;
};
const params = (maintenanceId = "1", id = "1") => Promise.resolve({ id, maintenanceId });
beforeEach(() => {
  vi.stubGlobal("React", React);
  connection = openDatabase(":memory:"); auth.signedIn = true;
  connection.db.insert(cars).values({ id: 1, nickname: "Synthetic car", createdAt: NOW, updatedAt: NOW }).run();
  connection.db.insert(cars).values({ id: 2, nickname: "Other car", createdAt: NOW, updatedAt: NOW }).run();
});
afterEach(() => { connection.sqlite.close(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("maintenance actions", () => {
  it("retains a recoverable retry state on transport failure and lets framework redirects through", async () => {
    expect(await maintenanceAttempt(async () => { throw new TypeError("Failed to fetch"); })).toMatchObject({ message: expect.stringMatching(/interrupted.*entries are still here/) });
    const acknowledgement = { message: "Saved" }; expect(await maintenanceAttempt(async () => acknowledgement)).toEqual(acknowledgement);
    await expect(maintenanceAttempt(async () => { throw new Error("REDIRECT:/sign-in"); })).rejects.toThrow("REDIRECT:/sign-in");
  });
  it("requires household sign-in before saving or deleting", async () => {
    const record = save(); auth.signedIn = false;
    await expect(saveMaintenanceAction(1, null, {}, form())).rejects.toThrow("SIGN_IN_REQUIRED");
    await expect(deleteMaintenanceAction(1, record.id, record.revision, {})).rejects.toThrow("SIGN_IN_REQUIRED");
    expect(maintenanceFor(connection.db, 1)).toHaveLength(1);
  });
  it("returns field errors, rejects bad retry metadata, and saves valid zero without trusting import provenance", async () => {
    expect(await saveMaintenanceAction(1, null, {}, form({ title: "" }))).toMatchObject({ errors: { title: expect.any(String) } });
    expect(await saveMaintenanceAction(1, null, {}, form({ requestKey: "bad" }))).toMatchObject({ message: expect.stringMatching(/Reload/) });
    await expect(saveMaintenanceAction(1, null, {}, form({ sourceDraftId: "forged" }))).rejects.toThrow("REDIRECT:/cars/1/maintenance/1");
    expect(maintenanceFor(connection.db, 1)).toMatchObject([{ baselineMiles: 0, sourceDraftId: null }]);
  });
  it("keeps a create retry safe after an ambiguous response and protects car scope", async () => {
    const data = form();
    for (let attempt = 0; attempt < 2; attempt++) await expect(saveMaintenanceAction(1, null, {}, data)).rejects.toThrow("REDIRECT:/cars/1/maintenance/1");
    expect(maintenanceFor(connection.db, 1)).toHaveLength(1);
    expect(await saveMaintenanceAction(2, 1, {}, form({ revision: "1" }))).toMatchObject({ stale: true, message: expect.stringMatching(/deleted/) });
  });
  it("returns stale state for conflicting saves/deletes and permits exact update retries", async () => {
    const record = save();
    const data = form({ requestKey: record.requestKey, revision: String(record.revision) });
    await expect(saveMaintenanceAction(1, record.id, {}, data)).rejects.toThrow("REDIRECT:");
    await expect(saveMaintenanceAction(1, record.id, {}, data)).rejects.toThrow("REDIRECT:");
    expect(getMaintenance(connection.db, 1, record.id)?.revision).toBe(2);
    const conflict = form({ requestKey: record.requestKey, revision: "1", notes: "Conflicting old tab" });
    expect(await saveMaintenanceAction(1, record.id, {}, conflict)).toMatchObject({ stale: true, message: expect.stringMatching(/another window/) });
    expect(await deleteMaintenanceAction(1, record.id, 1, {})).toMatchObject({ stale: true });
    await expect(deleteMaintenanceAction(1, record.id, 2, {})).rejects.toThrow("REDIRECT:/cars/1/maintenance");
    await expect(deleteMaintenanceAction(1, record.id, 2, {})).rejects.toThrow("REDIRECT:/cars/1/maintenance");
    expect(maintenanceFor(connection.db, 1)).toEqual([]);
  });
});

describe("maintenance pages and home component", () => {
  it("requires sign-in and refuses malformed, missing, or cross-car schedule addresses", async () => {
    save();
    for (const value of [params("abc"), params("9999"), params("1", "2")]) await expect(maintenanceFromParams(value)).rejects.toThrow("NOT_FOUND");
    auth.signedIn = false;
    await expect(MaintenancePage()).rejects.toThrow("SIGN_IN_REQUIRED");
    await expect(CarMaintenancePage({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("SIGN_IN_REQUIRED");
    await expect(NewMaintenancePage({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("SIGN_IN_REQUIRED");
    await expect(MaintenanceDetailPage({ params: params() })).rejects.toThrow("SIGN_IN_REQUIRED");
    await expect(EditMaintenancePage({ params: params() })).rejects.toThrow("SIGN_IN_REQUIRED");
  });
  it("renders an honest empty list, per-car entry, and the home empty state", async () => {
    const household = renderToStaticMarkup(await MaintenancePage());
    expect(household).toContain("No enabled schedules yet"); expect(household).toContain("/cars/1/maintenance");
    const car = renderToStaticMarkup(await CarMaintenancePage({ params: Promise.resolve({ id: "1" }) }));
    expect(car).toContain("No schedules yet"); expect(car).toContain("/cars/1/maintenance/new");
  });
  it("renders source import links and the readable due basis without inventing completions", async () => {
    const draftId = randomUUID();
    connection.db.insert(importDrafts).values({ id: draftId, type: "maintenance", carId: 1, payload: "{}", payloadHash: "synthetic", idempotencyKey: randomUUID(), createdAt: NOW, updatedAt: NOW }).run();
    const record = saveMaintenance(connection.db, 1, input, { requestKey: randomUUID(), sourceDraftId: draftId, now: NOW });
    const html = renderToStaticMarkup(await MaintenanceDetailPage({ params: params(String(record.id)) }));
    expect(html).toContain(`/imports/${draftId}`); expect(html).toContain("Manual baseline");
    expect(html).toContain("500 miles or 30 days"); expect(html).toContain("Jul 1, 2026");
    expect(html).not.toContain("View last completed service");
  });
  it("offers only this car's completed services and retains retry keys and zero in edit forms", async () => {
    const serviceInput = { kind: "service" as const, title: "This car completed work", date: "2026-01-01", miles: null, totalCents: null, lineItems: [], notes: null, shop: null };
    saveService(connection.db, 1, serviceInput, { requestKey: randomUUID(), now: NOW });
    saveService(connection.db, 1, { ...serviceInput, kind: "quote", title: "Excluded quote" }, { requestKey: randomUUID(), now: NOW });
    saveService(connection.db, 2, { ...serviceInput, title: "Other car service" }, { requestKey: randomUUID(), now: NOW });
    const html = renderToStaticMarkup(await NewMaintenancePage({ params: Promise.resolve({ id: "1" }) }));
    expect(html).toContain("This car completed work"); expect(html).not.toContain("Excluded quote"); expect(html).not.toContain("Other car service");
    expect(html).toContain('name="baselineDate"'); expect(html).toContain('name="enabled"');
    const record = saveMaintenance(connection.db, 1, { ...input, baselineMiles: 0 }, { requestKey: randomUUID(), now: NOW });
    const edit = renderToStaticMarkup(await EditMaintenancePage({ params: params(String(record.id)) }));
    expect(edit).toContain(record.requestKey); expect(edit).toContain('name="baselineMiles" value="0"');
  });
  it("groups the ledger by state, leaves turned-off work out of due groups, and links each row", () => {
    save(); save({ enabled: false, title: "Disabled synthetic work" });
    save({ title: "Unknown synthetic work", baselineDate: null });
    const items = householdMaintenanceDue(connection.db, NOW);
    const groups = groupLedger(items, () => null);
    expect(groups.map((group) => group.key)).toEqual(["overdue", "needs-baseline"]);
    const due = groups.find((group) => group.key === "overdue")!.items;
    expect(due.map(({ due }) => due.schedule.title)).toEqual(["Synthetic oil change"]);
    expect(due[0].line).toMatchObject({ interval: "Every 6 months", limit: "by Jul 1, 2026", tone: "due" });
    const html = renderToStaticMarkup(React.createElement(LedgerList, { items: due, showCar: true, markDone: true }));
    expect(html).toContain("Synthetic oil change"); expect(html).not.toContain("Disabled synthetic work");
    expect(html).toContain("past"); expect(html).toContain("Mark done");
    expect(html).toContain(`/cars/1/maintenance/${due[0].due.schedule.id}`);
  });
});

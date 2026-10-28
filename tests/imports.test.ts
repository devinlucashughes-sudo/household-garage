import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "./database";
import { cars, users, importTokens, importDrafts, importDraftReceipts, odometerReadings, serviceRecords, serviceReceipts, maintenanceSchedules } from "@/lib/schema";
import { createImportToken, revokeImportToken, authenticateImportToken, submitImport, getImportDraft, editImport, rejectImport, approveImport, addImportReceipt, getImportReceipt } from "@/lib/imports";
import { parseImportText, MAX_IMPORT_BYTES } from "@/lib/import-input";
import { MAX_RECEIPT_BYTES, MAX_RECEIPTS, type ServiceInput } from "@/lib/service-input";
import { saveService } from "@/lib/services";
import { snapshot } from "@/lib/backup";
import * as schema from "@/lib/schema";

const NOW = Date.UTC(2026, 9, 26, 17);
const pdf = Buffer.from("%PDF-1.4\nSynthetic original\n%%EOF");
let connection: ReturnType<typeof openDatabase>;
let secret: string;
const db = () => connection.db;
const service = (changes = {}) => ({ kind: "service", title: "Synthetic oil change", date: "2026-10-10", shop: null, miles: 1000, totalCents: null, lineItems: [], notes: null, ...changes });
const wire = (changes = {}) => ({ type: "service", carId: 1, requestId: randomUUID(), data: service(), ...changes });
const submit = (value = wire()) => submitImport(db(), JSON.stringify(value), { secret }, NOW);
beforeEach(() => {
  connection = openDatabase(":memory:");
  db().delete(users).run();
  db().insert(users).values({ id: 1, handle: "synthetic", name: "Synthetic reviewer", createdAt: NOW }).run();
  for (const id of [1, 2]) db().insert(cars).values({ id, nickname: `Synthetic car ${id}`, createdAt: NOW, updatedAt: NOW }).run();
  secret = createImportToken(db(), "Synthetic desktop", 1, NOW).secret;
});
afterEach(() => connection.sqlite.close());

describe("private desktop import domain", () => {
  it("stores only a credential hash, rejects unknown/revoked credentials, and requires a household reviewer", () => {
    const token = db().select().from(importTokens).get()!;
    expect(token.tokenHash).not.toContain(secret); expect(token.tokenHash).toHaveLength(64);
    expect(authenticateImportToken(db(), secret, NOW).id).toBe(token.id);
    expect(() => authenticateImportToken(db(), "hgi_" + "a".repeat(43))).toThrow(/invalid/);
    expect(() => createImportToken(db(), "Other", 999)).toThrow(/Sign in/);
    revokeImportToken(db(), token.id, 1, NOW);
    expect(() => submit()).toThrow(/revoked/);
  });
  it("rejects malformed, oversized, invalid dates, incorrect numeric types and unknown cars", () => {
    expect(() => parseImportText("{")).toThrow(/valid JSON/);
    expect(() => parseImportText(" ".repeat(MAX_IMPORT_BYTES + 1))).toThrow(/128 KB/);
    for (const data of [service({ date: "2026-02-30" }), service({ date: "2099-01-01" }), service({ totalCents: "0" }), service({ miles: -1 }), service({ totalCents: 1.5 })]) expect(() => submit(wire({ data }))).toThrow();
    expect(() => submit(wire({ carId: 999 }))).toThrow(/car/);
    expect(db().select().from(importDrafts).all()).toHaveLength(0);
  });
  it("binds requestId to source credential and payload, with stable retries after corrections", () => {
    const value = wire(); const first = submit(value);
    expect(submitImport(db(), JSON.stringify(value, null, 2), { secret }, NOW).id).toBe(first.id);
    expect(() => submit({ ...value, carId: 2 })).toThrow(/requestId/);
    expect(() => submit({ ...value, data: service({ totalCents: 0 }) })).toThrow(/requestId/);
    expect(() => submit({ ...value, data: service({ title: "Synthetic oil change " }) })).toThrow(/requestId/);
    const other = createImportToken(db(), "Other", 1, NOW).secret;
    expect(() => submitImport(db(), JSON.stringify(value), { secret: other }, NOW)).toThrow(/requestId/);
    editImport(db(), first.id, 1, 1, service({ title: "Corrected" }), 1, NOW);
    expect(submit(value).payload).toContain("Corrected");
  });
  it("preserves null and zero, isolates draft and rejected mileage/totals, and permits signed-in paste", () => {
    const zero = submit(wire({ data: service({ miles: 0, totalCents: 0, lineItems: [{ description: "Free", costCents: 0 }] }) }));
    expect(JSON.parse(zero.payload)).toMatchObject({ miles: 0, totalCents: 0 });
    const unknown = submitImport(db(), JSON.stringify(wire({ data: service({ miles: null }) })), { userId: 1 }, NOW);
    expect(JSON.parse(unknown.payload).totalCents).toBeNull();
    rejectImport(db(), unknown.id, 1, 1, 1, NOW);
    expect(db().select().from(serviceRecords).all()).toHaveLength(0);
    expect(db().select().from(odometerReadings).all()).toHaveLength(0);
    expect(() => approveImport(db(), unknown.id, 1, 2, 1, NOW)).toThrow(/reviewed/);
  });
  it("enforces car, revision, status and household boundaries for review", () => {
    const draft = submit();
    expect(() => editImport(db(), draft.id, 2, 1, service(), 1, NOW)).toThrow(/not found/);
    expect(() => approveImport(db(), draft.id, 2, 1, 1, NOW)).toThrow(/not found/);
    expect(() => rejectImport(db(), draft.id, 1, 1, 999, NOW)).toThrow(/Sign in/);
    editImport(db(), draft.id, 1, 1, service({ totalCents: 0 }), 1, NOW);
    expect(() => approveImport(db(), draft.id, 1, 1, 1, NOW)).toThrow(/another window/);
    expect(() => rejectImport(db(), draft.id, 1, 1, 1, NOW)).toThrow(/another window/);
  });
  it("validates signatures, byte/count limits, safe names, source ownership and upload retries", () => {
    const draft = submit();
    expect(() => addImportReceipt(db(), draft.id, 1, 1, "fake.pdf", Buffer.from("not PDF"), { secret }, NOW)).toThrow(/recognized/);
    expect(() => addImportReceipt(db(), draft.id, 1, 1, "big.pdf", Buffer.alloc(MAX_RECEIPT_BYTES + 1), { secret }, NOW)).toThrow(/10 MB/);
    const other = createImportToken(db(), "Other", 1, NOW).secret;
    expect(() => addImportReceipt(db(), draft.id, 1, 1, "a.pdf", pdf, { secret: other }, NOW)).toThrow(/not found/);
    expect(() => addImportReceipt(db(), draft.id, 2, 1, "a.pdf", pdf, { secret }, NOW)).toThrow(/not found/);
    const first = addImportReceipt(db(), draft.id, 1, 1, "../../x\r\n.pdf", pdf, { secret }, NOW);
    expect(first.revision).toBe(2);
    expect(addImportReceipt(db(), draft.id, 1, 1, "retry.pdf", pdf, { secret }, NOW).id).toBe(first.id);
    expect(getImportReceipt(db(), draft.id, first.id)?.name).not.toMatch(/[/\\\r\n]/);
    expect(() => approveImport(db(), draft.id, 1, 1, 1, NOW)).toThrow(/another window/);
    for (let i = 1; i < MAX_RECEIPTS; i++) addImportReceipt(db(), draft.id, 1, i + 1, "extra.pdf", Buffer.concat([pdf, Buffer.from(String(i))]), { secret }, NOW);
    expect(() => addImportReceipt(db(), draft.id, 1, 11, "extra.pdf", Buffer.concat([pdf, Buffer.from("last")]), { secret }, NOW)).toThrow(/10 originals/);
  });
  it("approves a service and copies originals atomically, with no duplicate approval retries", () => {
    const draft = submit(wire({ data: service({ totalCents: 0 }) }));
    addImportReceipt(db(), draft.id, 1, 1, "receipt.pdf", pdf, { secret }, NOW);
    const result = approveImport(db(), draft.id, 1, 2, 1, NOW);
    expect(result.status).toBe("approved");
    expect(approveImport(db(), draft.id, 1, 2, 1, NOW).approvedRecordId).toBe(result.approvedRecordId);
    expect(db().select().from(serviceRecords).all()).toHaveLength(1);
    expect(db().select().from(serviceRecords).get()?.totalCents).toBe(0);
    expect(db().select().from(odometerReadings).all()).toHaveLength(1);
    expect(db().select().from(serviceReceipts).get()?.bytes).toEqual(pdf);
    expect(db().select().from(importDraftReceipts).get()?.bytes).toEqual(pdf);
    expect(() => addImportReceipt(db(), draft.id, 1, 3, "new.pdf", pdf, { secret }, NOW)).toThrow(/pending/);
    expect(() => editImport(db(), draft.id, 1, 3, service(), 1, NOW)).toThrow(/reviewed/);
  });
  it("rolls back service, mileage and copied originals when a receipt fails, then allows retry", () => {
    const draft = submit();
    addImportReceipt(db(), draft.id, 1, 1, "first.pdf", pdf, { secret }, NOW);
    const file = addImportReceipt(db(), draft.id, 1, 2, "second.pdf", Buffer.concat([pdf, Buffer.from("second")]), { secret }, NOW);
    db().update(importDraftReceipts).set({ bytes: Buffer.from("invalid synthetic backup") }).where(eq(importDraftReceipts.id, file.id)).run();
    expect(() => approveImport(db(), draft.id, 1, 3, 1, NOW)).toThrow(/recognized/);
    expect(getImportDraft(db(), draft.id)?.status).toBe("draft");
    for (const table of [serviceRecords, serviceReceipts, odometerReadings]) expect(db().select().from(table).all()).toHaveLength(0);
    db().update(importDraftReceipts).set({ bytes: Buffer.concat([pdf, Buffer.from("second")]) }).where(eq(importDraftReceipts.id, file.id)).run();
    expect(approveImport(db(), draft.id, 1, 3, 1, NOW).status).toBe("approved");
    expect(db().select().from(serviceReceipts).all()).toHaveLength(2);
  });
  it("approves maintenance through the shared domain, retaining source files and preventing cross-car/quote links", () => {
    const schedule = { title: "Synthetic schedule", intervalMiles: 5000, intervalMonths: null, baselineDate: null, baselineMiles: 0, lastServiceId: null, enabled: true, notes: null };
    const draft = submit(wire({ type: "maintenance", data: schedule }));
    addImportReceipt(db(), draft.id, 1, 1, "manual.pdf", pdf, { secret }, NOW);
    const result = approveImport(db(), draft.id, 1, 2, 1, NOW);
    approveImport(db(), draft.id, 1, 2, 1, NOW);
    expect(db().select().from(maintenanceSchedules).all()).toHaveLength(1);
    expect(db().select().from(maintenanceSchedules).get()).toMatchObject({ sourceDraftId: draft.id, baselineMiles: 0, id: result.approvedRecordId });
    expect(db().select().from(importDraftReceipts).all()).toHaveLength(1);
    expect(db().select().from(serviceReceipts).all()).toHaveLength(0);
    expect(db().select().from(odometerReadings).all()).toHaveLength(0);
    for (const [carId, kind] of [[2, "service"], [1, "quote"]] as const) {
      const record = saveService(db(), carId, service({ kind, miles: null }) as ServiceInput, { requestKey: randomUUID(), now: NOW });
      const bad = submit(wire({ type: "maintenance", data: { ...schedule, lastServiceId: record.id } }));
      expect(() => approveImport(db(), bad.id, 1, 1, 1, NOW)).toThrow(/completed service/);
      expect(getImportDraft(db(), bad.id)?.status).toBe("draft");
    }
  });
  it("retains drafts, originals and maintenance source links in an actual SQLite backup", async () => {
    const pending = submit();
    addImportReceipt(db(), pending.id, 1, 1, "pending.pdf", pdf, { secret }, NOW);
    const schedule = submit(wire({ type: "maintenance", data: { title: "Synthetic schedule", intervalMonths: 6 } }));
    addImportReceipt(db(), schedule.id, 1, 1, "manual.pdf", pdf, { secret }, NOW);
    approveImport(db(), schedule.id, 1, 2, 1, NOW);
    const copy = new Database(Buffer.from(await snapshot(connection.sqlite)));
    try {
      const restored = drizzle(copy, { schema });
      expect(getImportDraft(restored, pending.id)?.status).toBe("draft");
      expect(getImportDraft(restored, schedule.id)?.status).toBe("approved");
      expect(restored.select().from(importDraftReceipts).all().map((f) => f.bytes)).toEqual([pdf, pdf]);
      expect(restored.select().from(maintenanceSchedules).get()?.sourceDraftId).toBe(schedule.id);
      expect(restored.select().from(importTokens).get()?.tokenHash).toHaveLength(64);
    } finally { copy.close(); }
  });
});

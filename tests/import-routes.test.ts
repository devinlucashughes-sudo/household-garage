import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "./database";
import { cars, users, importDraftReceipts, importDrafts, serviceRecords, maintenanceSchedules } from "@/lib/schema";
import { addImportReceipt, createImportToken, revokeImportToken, submitImport } from "@/lib/imports";
import { MAX_IMPORT_BYTES } from "@/lib/import-input";
import { MAX_RECEIPT_BYTES } from "@/lib/service-input";

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/lib/session", () => ({
  currentUser: async () => auth.signedIn ? { id: 1 } : null,
  requireUser: async () => { if (!auth.signedIn) throw new Error("SIGN_IN_REQUIRED"); return { id: 1 }; },
}));
vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  return { ...real, getDatabase: () => connection.db };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import { POST as postDraft } from "@/app/api/imports/route";
import { GET as getCars } from "@/app/api/imports/cars/route";
import { POST as postOriginal } from "@/app/api/imports/[id]/originals/route";
import { GET as getOriginal } from "@/app/api/imports/[id]/originals/[receiptId]/route";
import { createImportAccessAction, editImportAction, pasteImportAction, reviewImportAction, revokeImportAccessAction, uploadImportOriginalAction } from "@/app/import-actions";
import { saveServiceAction } from "@/app/service-actions";
import { saveMaintenanceAction } from "@/app/maintenance-actions";

let connection: ReturnType<typeof openDatabase>;
let secret: string, tokenId: string;
const pdf = Buffer.from("%PDF-1.4\nSynthetic source\n%%EOF");
const value = () => ({ type: "service", carId: 1, requestId: randomUUID(), data: { kind: "service", title: "Synthetic service", date: "2026-01-01", totalCents: 0 } });
const request = (body = JSON.stringify(value()), credential = secret, extra: Record<string, string> = {}) => new Request("http://localhost/api/imports", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}`, ...extra }, body });
const originalParams = (id: string, receiptId: string) => ({ params: Promise.resolve({ id, receiptId }) });
beforeEach(() => {
  connection = openDatabase(":memory:"); auth.signedIn = true;
  connection.db.delete(users).run();
  connection.db.insert(users).values({ id: 1, handle: "synthetic", name: "Synthetic reviewer", createdAt: 1 }).run();
  connection.db.insert(cars).values({ id: 1, nickname: "Synthetic car", vin: "SYNTHETICVIN", createdAt: 1, updatedAt: 1 }).run();
  const token = createImportToken(connection.db, "Synthetic desktop", 1); secret = token.secret; tokenId = token.id;
});
afterEach(() => connection.sqlite.close());

describe("desktop import HTTP boundaries", () => {
  it("requires a valid unrevoked credential for car listing and draft submission", async () => {
    expect((await postDraft(request("{}", "wrong"))).status).toBe(401);
    expect((await getCars(new Request("http://localhost/api/imports/cars"))).status).toBe(401);
    const carsResponse = await getCars(new Request("http://localhost/api/imports/cars", { headers: { Authorization: `Bearer ${secret}` } }));
    expect(await carsResponse.json()).toEqual({ cars: [{ id: 1, name: "Synthetic car", vin: "SYNTHETICVIN" }] });
    expect(carsResponse.headers.get("cache-control")).toContain("no-store");
    revokeImportToken(connection.db, tokenId, 1);
    expect((await postDraft(request())).status).toBe(401);
    expect((await getCars(new Request("http://localhost/api/imports/cars", { headers: { Authorization: `Bearer ${secret}` } }))).status).toBe(401);
  });
  it("rejects malformed, oversized declared and streaming bodies, mismatched cars and content types", async () => {
    expect((await postDraft(request("{"))).status).toBe(400);
    expect((await postDraft(request("{}", secret, { "Content-Length": String(MAX_IMPORT_BYTES + 1) }))).status).toBe(413);
    expect((await postDraft(request("x".repeat(MAX_IMPORT_BYTES + 1)))).status).toBe(413);
    expect((await postDraft(request(JSON.stringify({ ...value(), carId: 999 })))).status).toBe(404);
    expect((await postDraft(request("{}", secret, { "Content-Type": "text/plain" }))).status).toBe(415);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_IMPORT_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
    const streamed = new Request("http://localhost/api/imports", { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    expect((await postDraft(streamed)).status).toBe(413);
    expect(connection.db.select().from(importDrafts).all()).toHaveLength(0);
  });
  it("returns safe submission metadata and idempotent retries without completed data mutation", async () => {
    const source = value();
    const response = await postDraft(request(JSON.stringify(source)));
    const draft = await response.json();
    expect(response.status).toBe(200); expect(draft).toMatchObject({ status: "draft", revision: 1, carId: 1 });
    expect(draft).not.toHaveProperty("payload"); expect(draft).not.toHaveProperty("tokenId");
    expect((await (await postDraft(request(JSON.stringify(source)))).json()).id).toBe(draft.id);
    expect((await postDraft(request(JSON.stringify({ ...source, data: { ...source.data, totalCents: 5 } })))).status).toBe(409);
    expect(connection.db.select().from(serviceRecords).all()).toHaveLength(0);
    expect(connection.db.select().from(maintenanceSchedules).all()).toHaveLength(0);
  });
  it("uploads bounded originals only to the credential's pending draft and returns its new revision", async () => {
    const draft = submitImport(connection.db, JSON.stringify(value()), { secret });
    const upload = (credential = secret, carId = 1, body: Buffer = pdf, revision = 1) => postOriginal(new Request(`http://localhost/api/imports/${draft.id}/originals?carId=${carId}&revision=${revision}`, { method: "POST", headers: { Authorization: `Bearer ${credential}`, "X-File-Name": "source.pdf" }, body: new Uint8Array(body) }), { params: Promise.resolve({ id: draft.id }) });
    expect((await upload("bad")).status).toBe(401);
    const other = createImportToken(connection.db, "Other synthetic desktop", 1).secret;
    expect((await upload(other)).status).toBe(404);
    expect((await upload(secret, 2)).status).toBe(404);
    expect((await upload(secret, 1, Buffer.from("fake"))).status).toBe(400);
    expect((await upload(secret, 1, Buffer.alloc(MAX_RECEIPT_BYTES + 1))).status).toBe(413);
    const good = await upload(); expect(good.status).toBe(200); const saved = await good.json(); expect(saved.revision).toBe(2);
    expect((await (await upload()).json()).id).toBe(saved.id);
    expect((await upload(secret, 1, Buffer.concat([pdf, Buffer.from("second")]), 1)).status).toBe(409);
    expect(connection.db.select().from(importDraftReceipts).all()).toHaveLength(1);
  });
  it("protects source originals from credentials and signed-out users and sends safe download headers", async () => {
    const draft = submitImport(connection.db, JSON.stringify(value()), { secret });
    const file = addImportReceipt(connection.db, draft.id, 1, 1, "../../Reçu\r\n.pdf", pdf, { secret });
    const get = (id = draft.id, receiptId = String(file.id), download = false) => getOriginal(new Request(`http://localhost/api/imports/${id}/originals/${receiptId}${download ? "?download=1" : ""}`, { headers: { Authorization: `Bearer ${secret}` } }), originalParams(id, receiptId));
    auth.signedIn = false; expect((await get()).status).toBe(401);
    auth.signedIn = true;
    expect((await get(randomUUID())).status).toBe(404); expect((await get(draft.id, "../1")).status).toBe(404);
    const response = await get(); expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf);
    expect(response.headers.get("content-disposition")).toContain("Re%C3%A7u");
    expect(response.headers.get("content-disposition")).not.toMatch(/[\r\n]/);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await get(draft.id, String(file.id), true)).headers.get("content-disposition")).toContain("attachment;");
  });
  it("requires household sign-in for every access and review action, even with a desktop-created draft", async () => {
    const draft = submitImport(connection.db, JSON.stringify(value()), { secret }); auth.signedIn = false;
    const form = new FormData(); form.set("json", JSON.stringify(value())); form.set("name", "test");
    const calls = [
      () => createImportAccessAction({}, form), () => revokeImportAccessAction(tokenId, {}), () => pasteImportAction({}, form),
      () => editImportAction(draft.id, 1, 1, {}, form), () => reviewImportAction(draft.id, 1, 1, "approve", {}),
      () => reviewImportAction(draft.id, 1, 1, "reject", {}), () => uploadImportOriginalAction(draft.id, 1, 1, {}, form),
    ];
    for (const call of calls) await expect(call()).resolves.toMatchObject({ signInRequired: true, message: expect.stringContaining("entries are still here") });
    expect(connection.db.select().from(importDrafts).get()?.status).toBe("draft");
    expect(connection.db.select().from(serviceRecords).all()).toHaveLength(0);
  });
  it.each(["service", "quote"])("allows an approved imported %s to be edited or completed through its normal save action", async (kind) => {
    const draft = submitImport(connection.db, JSON.stringify({ ...value(), data: { ...value().data, kind } }), { secret });
    await reviewImportAction(draft.id, 1, 1, "approve", {});
    const saved = connection.db.select().from(serviceRecords).get()!;
    expect(saved.requestKey).toBe(draft.id);
    const form = new FormData();
    for (const [key, text] of Object.entries({ kind: "service", title: "Edited imported work", date: "2026-01-01", miles: "10000", totalCents: "0", shop: "", notes: "", requestKey: saved.requestKey, revision: String(saved.revision) })) form.set(key, text);
    await expect(saveServiceAction(1, saved.id, {}, form)).rejects.toThrow(`REDIRECT:/cars/1/services/${saved.id}`);
    expect(connection.db.select().from(serviceRecords).get()).toMatchObject({ id: saved.id, kind: "service", title: "Edited imported work", miles: 10000, totalCents: 0, revision: 2 });
  });
  it("allows an approved imported maintenance schedule to be edited through its normal save action", async () => {
    const draft = submitImport(connection.db, JSON.stringify({ ...value(), type: "maintenance", data: { title: "Imported interval", intervalMonths: 6 } }), { secret });
    await reviewImportAction(draft.id, 1, 1, "approve", {});
    const saved = connection.db.select().from(maintenanceSchedules).get()!;
    const form = new FormData();
    for (const [key, text] of Object.entries({ title: "Edited interval", intervalMiles: "5000", intervalMonths: "", baselineDate: "", baselineMiles: "0", lastServiceId: "", enabled: "on", notes: "", requestKey: saved.requestKey, revision: String(saved.revision) })) form.set(key, text);
    await expect(saveMaintenanceAction(1, saved.id, {}, form)).rejects.toThrow(`REDIRECT:/cars/1/maintenance/${saved.id}`);
    expect(connection.db.select().from(maintenanceSchedules).get()).toMatchObject({ id: saved.id, title: "Edited interval", intervalMiles: 5000, intervalMonths: null, sourceDraftId: draft.id, revision: 2 });
  });
  it("reviews service and schedule submissions through signed-in actions and retries approval safely", async () => {
    const draft = submitImport(connection.db, JSON.stringify(value()), { secret });
    expect(await reviewImportAction(draft.id, 1, 1, "approve", {})).toMatchObject({ success: true });
    expect(await reviewImportAction(draft.id, 1, 1, "approve", {})).toMatchObject({ success: true });
    const schedule = submitImport(connection.db, JSON.stringify({ ...value(), type: "maintenance", data: { title: "Synthetic schedule", intervalMonths: 6 } }), { secret });
    expect(await reviewImportAction(schedule.id, 1, 1, "approve", {})).toMatchObject({ success: true });
    expect(connection.db.select().from(serviceRecords).all()).toHaveLength(1);
    expect(connection.db.select().from(maintenanceSchedules).get()?.sourceDraftId).toBe(schedule.id);
  });
  it("corrects drafts using ordinary form fields, preserving blank versus zero and validation feedback", async () => {
    const draft = submitImport(connection.db, JSON.stringify(value()), { secret });
    const form = new FormData();
    for (const [key, text] of Object.entries({ format: "fields", kind: "service", title: "Corrected synthetic service", date: "2026-01-01", shop: "", miles: "0", totalCents: "0.00", notes: "" })) form.set(key, text);
    expect(await editImportAction(draft.id, 1, 1, {}, form)).toMatchObject({ success: true });
    expect(JSON.parse(connection.db.select().from(importDrafts).get()!.payload)).toMatchObject({ title: "Corrected synthetic service", totalCents: 0, miles: 0, shop: null });
    form.set("totalCents", "invalid");
    expect(await editImportAction(draft.id, 1, 2, {}, form)).toMatchObject({ errors: { totalCents: expect.any(String) } });
    form.set("totalCents", ""); form.set("miles", "");
    expect(await editImportAction(draft.id, 1, 2, {}, form)).toMatchObject({ success: true });
    expect(JSON.parse(connection.db.select().from(importDrafts).get()!.payload)).toMatchObject({ totalCents: null, miles: null });
    const schedule = submitImport(connection.db, JSON.stringify({ ...value(), type: "maintenance", data: { title: "Synthetic schedule", intervalMonths: 6 } }), { secret });
    const scheduleForm = new FormData();
    for (const [key, text] of Object.entries({ format: "fields", title: "Corrected synthetic schedule", intervalMiles: "5000", intervalMonths: "", baselineMiles: "0", baselineDate: "", lastServiceId: "", notes: "", enabled: "on" })) scheduleForm.set(key, text);
    expect(await editImportAction(schedule.id, 1, 1, {}, scheduleForm)).toMatchObject({ success: true });
    const saved = connection.db.select().from(importDrafts).all().find((d) => d.id === schedule.id)!;
    expect(JSON.parse(saved.payload)).toMatchObject({ intervalMiles: 5000, intervalMonths: null, baselineMiles: 0, enabled: true });
  });
});

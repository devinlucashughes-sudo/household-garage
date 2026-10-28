import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { AppDatabase, QueryDatabase } from "./db";
import { cars, importDraftReceipts, importDrafts, importTokens, users } from "./schema";
import { ImportError, normalizeImportData, parseImportText } from "./import-input";
import { addReceipt, receiptMime, saveService } from "./services";
import { MAX_RECEIPT_BYTES, MAX_RECEIPTS, type ServiceInput } from "./service-input";
import { saveMaintenance } from "./maintenance";
import { maintenanceInputSchema } from "./maintenance-input";

export { ImportError } from "./import-input";
export type ImportDraft = typeof importDrafts.$inferSelect;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
// Sort object keys so JSON whitespace and key order do not change request identity.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return "{" + entries.join(",") + "}";
  }
  return JSON.stringify(value);
}
function member(db: QueryDatabase, userId: number) {
  if (!db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get()) throw new ImportError("Sign in to review imports.", 401);
}
export function createImportToken(db: AppDatabase, name: string, userId: number, now = Date.now()) {
  member(db, userId);
  name = name.trim();
  if (!name || name.length > 80) throw new ImportError("Give this desktop access a name under 80 characters.");
  const secret = `hgi_${randomBytes(32).toString("base64url")}`;
  const token = db.insert(importTokens).values({ id: randomUUID(), name, tokenHash: hash(secret), createdBy: userId, createdAt: now }).returning({ id: importTokens.id }).get();
  return { ...token, secret };
}
export function importTokensFor(db: QueryDatabase) {
  return db.select({ id: importTokens.id, name: importTokens.name, createdAt: importTokens.createdAt, lastUsedAt: importTokens.lastUsedAt, revokedAt: importTokens.revokedAt }).from(importTokens).orderBy(desc(importTokens.createdAt)).all();
}
export function revokeImportToken(db: AppDatabase, id: string, userId: number, now = Date.now()) {
  member(db, userId);
  db.update(importTokens).set({ revokedAt: now }).where(eq(importTokens.id, id)).run();
}
export function authenticateImportToken(db: QueryDatabase, secret: string | null, now = Date.now()) {
  if (!secret || !/^hgi_[A-Za-z0-9_-]{43}$/.test(secret)) throw new ImportError("Desktop access is invalid or revoked.", 401);
  const token = db.select().from(importTokens).where(eq(importTokens.tokenHash, hash(secret))).get();
  if (!token || token.revokedAt !== null) throw new ImportError("Desktop access is invalid or revoked.", 401);
  db.update(importTokens).set({ lastUsedAt: now }).where(eq(importTokens.id, token.id)).run();
  return token;
}
export type ImportActor = { userId: number; secret?: never } | { secret: string; userId?: never };
export function submitImport(db: AppDatabase, text: string, actor: ImportActor, now = Date.now()) {
  return db.transaction((tx) => {
    const token = actor.secret !== undefined ? authenticateImportToken(tx, actor.secret, now) : null;
    if (!token) member(tx, actor.userId!);
    const value = parseImportText(text, now);
    if (!tx.select({ id: cars.id }).from(cars).where(eq(cars.id, value.carId)).get()) throw new ImportError("Choose a car in this garage.", 404);
    const payloadHash = hash(canonical(JSON.parse(text)));
    const retry = tx.select().from(importDrafts).where(eq(importDrafts.idempotencyKey, value.requestId)).get();
    if (retry) {
      if (retry.tokenId !== (token?.id ?? null) || retry.payloadHash !== payloadHash) throw new ImportError("This requestId already belongs to a different submission. Use a new requestId for new data.", 409);
      return retry;
    }
    return tx.insert(importDrafts).values({ id: randomUUID(), carId: value.carId, type: value.type, payload: JSON.stringify(value.data), payloadHash,
      sourceLabel: value.sourceLabel, idempotencyKey: value.requestId, tokenId: token?.id, createdBy: actor.userId, createdAt: now, updatedAt: now }).returning().get();
  });
}
export const getImportDraft = (db: QueryDatabase, id: string) => db.select().from(importDrafts).where(eq(importDrafts.id, id)).get() ?? null;
export const importsFor = (db: QueryDatabase) => db.select().from(importDrafts).orderBy(desc(importDrafts.createdAt)).all();
export const importReceiptsFor = (db: QueryDatabase, draftId: string) => db.select({ id: importDraftReceipts.id, name: importDraftReceipts.name, size: importDraftReceipts.size, mime: importDraftReceipts.mime }).from(importDraftReceipts).where(eq(importDraftReceipts.draftId, draftId)).all();
function editable(db: QueryDatabase, id: string, revision: number, carId: number) {
  const draft = getImportDraft(db, id);
  if (!draft || draft.carId !== carId) throw new ImportError("Import not found.", 404);
  if (draft.status !== "draft") throw new ImportError("This import has already been reviewed. Open the latest import.", 409);
  if (draft.revision !== revision) throw new ImportError("This import changed in another window. Your entries are still here. Open the latest import before saving again.", 409);
  return draft;
}
export function editImport(db: AppDatabase, id: string, carId: number, revision: number, data: unknown, userId: number, now = Date.now()) {
  return db.transaction((tx) => {
    member(tx, userId);
    const draft = editable(tx, id, revision, carId);
    const payload = JSON.stringify(normalizeImportData(draft.type, data, now));
    return tx.update(importDrafts).set({ payload, revision: draft.revision + 1, updatedAt: now }).where(eq(importDrafts.id, id)).returning().get();
  });
}
export function rejectImport(db: AppDatabase, id: string, carId: number, revision: number, userId: number, now = Date.now()) {
  return db.transaction((tx) => {
    member(tx, userId); const draft = editable(tx, id, revision, carId);
    return tx.update(importDrafts).set({ status: "rejected", revision: draft.revision + 1, updatedAt: now }).where(eq(importDrafts.id, id)).returning().get();
  });
}
export function approveImport(db: AppDatabase, id: string, carId: number, revision: number, userId: number, now = Date.now()) {
  return db.transaction((tx) => {
    member(tx, userId);
    const existing = getImportDraft(tx, id);
    if (!existing || existing.carId !== carId) throw new ImportError("Import not found.", 404);
    // A lost approval response may be retried with the originally acknowledged revision.
    if (existing.status === "approved" && existing.revision === revision + 1) return existing;
    const draft = editable(tx, id, revision, carId);
    const input = normalizeImportData(draft.type, JSON.parse(draft.payload), now);
    const options = { requestKey: id, createdBy: userId, now };
    // Existing service APIs type their connection as AppDatabase. Use the same
    // synchronous connection inside this outer transaction; nested saves use savepoints.
    const record = draft.type === "service"
      ? saveService(db, carId, input as ServiceInput, options)
      : saveMaintenance(tx, carId, maintenanceInputSchema.parse(input), { ...options, sourceDraftId: id });
    if (draft.type === "service") {
      const originals = tx.select().from(importDraftReceipts).where(eq(importDraftReceipts.draftId, id)).all();
      for (const file of originals) addReceipt(db, carId, record.id, file.name, file.bytes, now);
    }
    return tx.update(importDrafts).set({ status: "approved", approvedRecordId: record.id, revision: draft.revision + 1, updatedAt: now }).where(eq(importDrafts.id, id)).returning().get();
  });
}
export function addImportReceipt(db: AppDatabase, id: string, carId: number, revision: number, name: string, bytes: Buffer, actor: ImportActor, now = Date.now()) {
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES) throw new ImportError("Choose an original no larger than 10 MB.", 413);
  const mime = receiptMime(bytes);
  if (!mime) throw new ImportError("Use a PDF, JPEG, PNG, WebP or HEIC photo. This file wasn't recognized.");
  return db.transaction((tx) => {
    const token = actor.secret !== undefined ? authenticateImportToken(tx, actor.secret, now) : null;
    if (!token) member(tx, actor.userId!);
    const found = getImportDraft(tx, id);
    if (!found || found.carId !== carId || (token && found.tokenId !== token.id)) throw new ImportError("Import not found.", 404);
    if (found.status !== "draft") throw new ImportError("Originals can only be added to pending imports.", 409);
    const retry = tx.select({ id: importDraftReceipts.id }).from(importDraftReceipts).where(and(eq(importDraftReceipts.draftId, id), eq(importDraftReceipts.bytes, bytes))).get();
    if (retry) return { ...retry, revision: found.revision };
    editable(tx, id, revision, carId);
    if (importReceiptsFor(tx, id).length >= MAX_RECEIPTS) throw new ImportError(`An import can have up to ${MAX_RECEIPTS} originals.`);
    const cleanName = name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 200).trim() || "Original";
    const receipt = tx.insert(importDraftReceipts).values({ draftId: id, name: cleanName, mime, size: bytes.length, bytes, createdAt: now }).returning({ id: importDraftReceipts.id }).get();
    tx.update(importDrafts).set({ revision: found.revision + 1, updatedAt: now }).where(eq(importDrafts.id, id)).run();
    return { ...receipt, revision: found.revision + 1 };
  });
}
export function getImportReceipt(db: QueryDatabase, id: string, receiptId: number) {
  return db.select().from(importDraftReceipts).where(and(eq(importDraftReceipts.draftId, id), eq(importDraftReceipts.id, receiptId))).get() ?? null;
}

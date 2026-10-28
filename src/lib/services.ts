import { and, desc, eq } from "drizzle-orm";
import type { AppDatabase, QueryDatabase } from "./db";
import { addReading, readingsFor } from "./cars";
import { guessCategory } from "./cost-categories";
import { dateInputValue, datedReadingTime } from "./format";
import { cars, odometerReadings, serviceReceipts, serviceRecords } from "./schema";
import { MAX_RECEIPT_BYTES, MAX_RECEIPTS, type LineItem, type ServiceInput } from "./service-input";

export type ServiceRecord = typeof serviceRecords.$inferSelect;
export class ServiceError extends Error {
  constructor(message: string, public field?: string) { super(message); }
}

export const servicesFor = (db: AppDatabase, carId: number, kind: ServiceRecord["kind"] = "service") =>
  db.select().from(serviceRecords).where(and(eq(serviceRecords.carId, carId), eq(serviceRecords.kind, kind)))
    .orderBy(desc(serviceRecords.date), desc(serviceRecords.id)).all();

export const getService = (db: QueryDatabase, carId: number, id: number) =>
  db.select().from(serviceRecords).where(and(eq(serviceRecords.carId, carId), eq(serviceRecords.id, id))).get() ?? null;

export const itemsFor = (record: ServiceRecord): LineItem[] => JSON.parse(record.lineItems);

export function saveService(
  db: AppDatabase, carId: number, input: ServiceInput,
  options: { id?: number; revision?: number; requestKey: string; createdBy?: number; now?: number },
) {
  const now = options.now ?? Date.now();
  return db.transaction((tx) => {
    if (!tx.select({ id: cars.id }).from(cars).where(eq(cars.id, carId)).get())
      throw new ServiceError("This car is no longer in the garage.");
    const previous = options.id === undefined ? null : getService(tx, carId, options.id);
    if (options.id !== undefined && !previous) throw new ServiceError("This record was deleted. Return to the car's history.");
    if (previous && previous.revision !== options.revision)
      throw new ServiceError("This record changed in another window. Your entries are still here. Open the latest record before saving again.");
    if (!previous) {
      const retry = tx.select().from(serviceRecords).where(eq(serviceRecords.requestKey, options.requestKey)).get();
      if (retry) {
        if (retry.carId !== carId) throw new ServiceError("Reload the form and try again.");
        return retry;
      }
    }
    if (input.date > dateInputValue(now)) throw new ServiceError("The record date cannot be in the future.", "date");
    const category = input.category ?? previous?.category ?? guessCategory(input.title);
    const values = { ...input, category, lineItems: JSON.stringify(input.lineItems), updatedAt: now };
    const record = previous
      ? tx.update(serviceRecords).set({ ...values, revision: previous.revision + 1 }).where(eq(serviceRecords.id, previous.id)).returning().get()
      : tx.insert(serviceRecords).values({ ...values, carId, requestKey: options.requestKey, createdBy: options.createdBy, createdAt: now }).returning().get();
    tx.delete(odometerReadings).where(and(eq(odometerReadings.carId, carId), eq(odometerReadings.source, "service"), eq(odometerReadings.sourceId, record.id))).run();
    if (record.kind === "service" && record.miles !== null) {
      const readAt = datedReadingTime(record.date, record.miles, readingsFor(tx, carId), now);
      if (readAt === null) throw new ServiceError("The same-day readings leave no room for this odometer value. Check the date and the existing mileage readings.", "miles");
      const result = addReading(tx, { carId, miles: record.miles, readAt, source: "service", sourceId: record.id, createdBy: options.createdBy }, now);
      if (!result.ok) throw new ServiceError(result.message, "miles");
    }
    return record;
  });
}

export function deleteService(db: AppDatabase, carId: number, id: number, revision: number) {
  db.transaction((tx) => {
    const record = getService(tx, carId, id);
    if (!record) return;
    if (record.revision !== revision) throw new ServiceError("This record changed. Reload it before deleting.");
    tx.delete(odometerReadings).where(and(eq(odometerReadings.carId, carId), eq(odometerReadings.source, "service"), eq(odometerReadings.sourceId, id))).run();
    tx.delete(serviceRecords).where(eq(serviceRecords.id, id)).run();
  });
}

const receiptFields = { id: serviceReceipts.id, name: serviceReceipts.name, mime: serviceReceipts.mime, size: serviceReceipts.size, createdAt: serviceReceipts.createdAt };
export const receiptsFor = (db: QueryDatabase, serviceId: number) =>
  db.select(receiptFields).from(serviceReceipts).where(eq(serviceReceipts.serviceId, serviceId)).orderBy(desc(serviceReceipts.createdAt), desc(serviceReceipts.id)).all();

/** Detect supported file signatures instead of trusting the filename or browser MIME. */
export function receiptMime(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const length = Math.min(bytes.readUInt32BE(0), bytes.length, 256);
    for (let offset = 8; offset + 4 <= length; offset += 4) {
      if (offset === 12) continue;
      if (["heic", "heix", "hevc", "hevx"].includes(bytes.subarray(offset, offset + 4).toString("ascii"))) return "image/heic";
    }
  }
  return null;
}

export function addReceipt(db: AppDatabase, carId: number, serviceId: number, name: string, bytes: Buffer, now = Date.now()) {
  if (bytes.length === 0 || bytes.length > MAX_RECEIPT_BYTES) throw new ServiceError("Choose a receipt no larger than 10 MB.");
  const mime = receiptMime(bytes);
  if (!mime) throw new ServiceError("Use a PDF, JPEG, PNG, WebP or HEIC photo. This file wasn't recognized.");
  const cleanName = name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 200).trim() || "Receipt";
  return db.transaction((tx) => {
    if (!getService(tx, carId, serviceId)) throw new ServiceError("This record was deleted. Return to the car's history.");
    const retry = tx.select({ id: serviceReceipts.id }).from(serviceReceipts)
      .where(and(eq(serviceReceipts.serviceId, serviceId), eq(serviceReceipts.bytes, bytes))).get();
    if (retry) return retry;
    if (receiptsFor(tx, serviceId).length >= MAX_RECEIPTS) throw new ServiceError(`A record can have up to ${MAX_RECEIPTS} receipts. Remove one before adding another.`);
    return tx.insert(serviceReceipts).values({ serviceId, name: cleanName, mime, size: bytes.length, bytes, createdAt: now }).returning({ id: serviceReceipts.id }).get();
  });
}

export function getReceipt(db: AppDatabase, carId: number, serviceId: number, receiptId: number) {
  if (!getService(db, carId, serviceId)) return null;
  return db.select().from(serviceReceipts).where(and(eq(serviceReceipts.serviceId, serviceId), eq(serviceReceipts.id, receiptId))).get() ?? null;
}

export function deleteReceipt(db: AppDatabase, carId: number, serviceId: number, receiptId: number) {
  if (!getService(db, carId, serviceId)) return;
  db.delete(serviceReceipts).where(and(eq(serviceReceipts.serviceId, serviceId), eq(serviceReceipts.id, receiptId))).run();
}

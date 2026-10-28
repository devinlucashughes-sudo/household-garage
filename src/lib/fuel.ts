import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase, QueryDatabase } from "./db";
import { addReading, readingsFor } from "./cars";
import { dateInputValue, datedReadingTime } from "./format";
import { fuelInputSchema, type FuelInput } from "./fuel-input";
import { cars, fuelRecords, odometerReadings } from "./schema";

export type FuelRecord = typeof fuelRecords.$inferSelect;
export type FuelDatabase = Pick<AppDatabase, "select" | "insert" | "update" | "delete" | "transaction">;
export type FuelSaveOptions = { id?: number; revision?: number; requestKey: string; createdBy?: number; now?: number };
export class FuelError extends Error {
  constructor(message: string, public field?: string) { super(message); }
}
export const fuelFor = (db: QueryDatabase, carId: number): FuelRecord[] => db.select().from(fuelRecords)
  .where(eq(fuelRecords.carId, carId)).orderBy(desc(fuelRecords.date), desc(fuelRecords.miles), desc(fuelRecords.id)).all();
export const getFuel = (db: QueryDatabase, carId: number, id: number): FuelRecord | null => db.select().from(fuelRecords)
  .where(and(eq(fuelRecords.carId, carId), eq(fuelRecords.id, id))).get() ?? null;
const sameInput = (record: FuelRecord, input: FuelInput) => (Object.keys(input) as (keyof FuelInput)[]).every((key) => record[key] === input[key]);
const ownedReading = (carId: number, id: number) => and(eq(odometerReadings.carId, carId), eq(odometerReadings.source, "fill-up"), eq(odometerReadings.sourceId, id));

/** Edits reuse the record's requestKey so an interrupted edit can be retried safely. */
export function saveFuel(db: FuelDatabase, carId: number, rawInput: FuelInput, options: FuelSaveOptions): FuelRecord {
  const parsed = fuelInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new FuelError(parsed.error.issues[0].message, String(parsed.error.issues[0].path[0]));
  const input = parsed.data;
  if (!z.string().trim().min(1).max(200).safeParse(options.requestKey).success) throw new FuelError("Reload the form before saving.");
  const now = options.now ?? Date.now();
  return db.transaction((tx) => {
    if (!tx.select({ id: cars.id }).from(cars).where(eq(cars.id, carId)).get()) throw new FuelError("This car is no longer in the garage.");
    const previous = options.id === undefined ? null : getFuel(tx, carId, options.id);
    if (options.id !== undefined && !previous) throw new FuelError("This fill-up was deleted. Return to fuel history.");
    if (previous && previous.revision !== options.revision) {
      if (previous.revision === (options.revision ?? 0) + 1 && previous.requestKey === options.requestKey && sameInput(previous, input)) return previous;
      throw new FuelError("This fill-up changed in another window. Your entries are still here. Open the latest record before saving again.");
    }
    if (!previous) {
      const retry = tx.select().from(fuelRecords).where(eq(fuelRecords.requestKey, options.requestKey)).get();
      if (retry) {
        if (retry.carId !== carId || !sameInput(retry, input)) throw new FuelError("This retry belongs to a different fill-up. Reload the form before saving.");
        return retry;
      }
    }
    if (input.date > dateInputValue(now)) throw new FuelError("The fill-up date cannot be in the future.", "date");
    const record = previous
      ? tx.update(fuelRecords).set({ ...input, updatedAt: now, revision: previous.revision + 1 }).where(eq(fuelRecords.id, previous.id)).returning().get()
      : tx.insert(fuelRecords).values({ ...input, carId, requestKey: options.requestKey, createdBy: options.createdBy, createdAt: now, updatedAt: now }).returning().get();
    tx.delete(odometerReadings).where(ownedReading(carId, record.id)).run();
    const readAt = datedReadingTime(record.date, record.miles, readingsFor(tx, carId), now);
    if (readAt === null)
      throw new FuelError("The same-day readings leave no room for this odometer value. Check the date and the existing mileage readings.", "miles");
    const result = addReading(tx, { carId, miles: record.miles, readAt, source: "fill-up", sourceId: record.id, createdBy: options.createdBy }, now);
    if (!result.ok) throw new FuelError(result.message, "miles");
    return record;
  });
}

export function deleteFuel(db: FuelDatabase, carId: number, id: number, revision: number): void {
  db.transaction((tx) => {
    const previous = getFuel(tx, carId, id);
    if (!previous) return;
    if (previous.revision !== revision) throw new FuelError("This fill-up changed. Open the latest record before deleting.");
    tx.delete(odometerReadings).where(ownedReading(carId, id)).run();
    tx.delete(fuelRecords).where(and(eq(fuelRecords.carId, carId), eq(fuelRecords.id, id))).run();
  });
}

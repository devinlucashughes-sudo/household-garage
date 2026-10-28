import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase, QueryDatabase } from "./db";
import { formatMiles, formatShortDay } from "./format";
import { estimateMileage, readingProblem, type Reading } from "./mileage";
import { parseReference, type QuickReference } from "./reference";
import { cars, odometerReadings } from "./schema";
import { fetchVinDetails, isVin, mergeDecoded, normalizeVin, type VinDetails } from "./vin";

export type Car = typeof cars.$inferSelect;
export type OdometerReading = typeof odometerReadings.$inferSelect;
export type ReadingSource = OdometerReading["source"];

/** The highest odometer the app accepts; anything bigger is a typo. */
export const MAX_MILES = 2_000_000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .transform((v) => v || null);

export const carInputSchema = z.object({
  nickname: z.string().trim().min(1, "Give the car a nickname.").max(40, "Keep the nickname short."),
  year: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return null;
      const year = Number(v);
      const latest = new Date().getFullYear() + 2;
      if (!/^\d{4}$/.test(v) || year < 1900 || year > latest) {
        ctx.addIssue({ code: "custom", message: "The year should look like 2019." });
        return z.NEVER;
      }
      return year;
    }),
  make: optionalText(40),
  model: optionalText(60),
  trim: optionalText(80),
  engine: optionalText(80),
  color: optionalText(40),
  plate: optionalText(20),
  vin: z.string().transform((v, ctx) => {
    const vin = normalizeVin(v);
    if (!vin) return null;
    if (!isVin(vin)) {
      ctx.addIssue({
        code: "custom",
        message: "A VIN is 17 letters and numbers, without I, O or Q. Check it against the car.",
      });
      return z.NEVER;
    }
    return vin;
  }),
  notes: optionalText(1000),
});

export type CarInput = z.infer<typeof carInputSchema>;
export const CAR_FIELDS = [
  "nickname",
  "year",
  "make",
  "model",
  "trim",
  "engine",
  "color",
  "plate",
  "vin",
  "notes",
] as const;

export const milesSchema = z
  .string()
  .transform((v) => v.replace(/[,\s]/g, ""))
  .pipe(z.string().regex(/^\d+$/, "Type the miles as a whole number, like 47950."))
  .transform(Number)
  .pipe(z.number().max(MAX_MILES, "That's more miles than an odometer shows. Check the number."));

/** "2019 Honda CR-V EX", or null when none of it is known yet. */
export function carTitle(car: Pick<Car, "year" | "make" | "model" | "trim">) {
  const title = [car.year, car.make, car.model, car.trim].filter(Boolean).join(" ");
  return title || null;
}

export function vinDetailsOf(car: Pick<Car, "vinDetails">): VinDetails | null {
  if (!car.vinDetails) return null;
  try {
    return JSON.parse(car.vinDetails) as VinDetails;
  } catch {
    return null;
  }
}

export const referenceOf = (car: Pick<Car, "reference">): QuickReference => parseReference(car.reference);

// Cars

export const listCars = (db: AppDatabase) =>
  db.select().from(cars).orderBy(asc(cars.createdAt), asc(cars.id)).all();

export const getCar = (db: AppDatabase, id: number) =>
  db.select().from(cars).where(eq(cars.id, id)).get() ?? null;

export type SavedCar = {
  car: Car;
  /** Set when the VIN couldn't be looked up; the car is saved anyway. */
  lookupFailed: boolean;
};

/**
 * Adds a car, or saves changes to one. A new or changed VIN is looked up once at NHTSA, and the
 * answer fills in whatever the person didn't type or correct themselves. A VIN whose lookup
 * failed is tried again on the next save.
 */
export async function saveCar(
  db: AppDatabase,
  input: CarInput,
  options: { id?: number; now?: number; fetcher?: typeof fetch } = {},
): Promise<SavedCar> {
  const now = options.now ?? Date.now();
  const previous = options.id ? getCar(db, options.id) : null;
  if (options.id && !previous) throw new Error("That car isn't in the garage.");

  let values: CarInput = input;
  let vinDetails = previous?.vinDetails ?? null;
  let vinDecodedAt = previous?.vinDecodedAt ?? null;
  let lookupFailed = false;
  const lastDecode = previous ? vinDetailsOf(previous) : null;
  if (!input.vin) {
    vinDetails = null;
    vinDecodedAt = null;
  } else if (input.vin !== lastDecode?.vin) {
    try {
      const details = await fetchVinDetails(input.vin, options.fetcher);
      values = mergeDecoded(input, lastDecode ?? {}, details);
      vinDetails = JSON.stringify(details);
      vinDecodedAt = now;
    } catch {
      lookupFailed = true;
      vinDetails = null;
      vinDecodedAt = null;
    }
  }

  const row = { ...values, vinDetails, vinDecodedAt, updatedAt: now };
  const car = previous
    ? db.update(cars).set(row).where(eq(cars.id, previous.id)).returning().get()
    : db.insert(cars).values({ ...row, createdAt: now }).returning().get();
  return { car, lookupFailed };
}

export function saveReference(db: AppDatabase, carId: number, reference: QuickReference, now = Date.now()) {
  db.update(cars)
    .set({ reference: JSON.stringify(reference), updatedAt: now })
    .where(eq(cars.id, carId))
    .run();
}

export function deleteCar(db: AppDatabase, carId: number) {
  db.delete(cars).where(eq(cars.id, carId)).run();
}

// Odometer readings

/** Newest first. */
export const readingsFor = (db: QueryDatabase, carId: number) =>
  db
    .select()
    .from(odometerReadings)
    .where(eq(odometerReadings.carId, carId))
    .orderBy(desc(odometerReadings.readAt), desc(odometerReadings.miles))
    .all();

export const describeReading = (r: Reading, now = Date.now()) =>
  `${formatMiles(r.miles)} recorded on ${formatShortDay(r.at, now)}`;

export type NewReading = {
  carId: number;
  miles: number;
  readAt: number;
  source: ReadingSource;
  sourceId?: number | null;
  note?: string | null;
  createdBy?: number | null;
};

export function addReading(
  db: QueryDatabase,
  reading: NewReading,
  now = Date.now(),
): { ok: true; reading: OdometerReading } | { ok: false; message: string } {
  if (reading.readAt > now) return { ok: false, message: "That date is in the future." };
  const existing = readingsFor(db, reading.carId).map((r) => ({ miles: r.miles, at: r.readAt }));
  const problem = readingProblem(existing, { miles: reading.miles, at: reading.readAt }, (r) =>
    describeReading(r, now),
  );
  if (problem) return { ok: false, message: problem };
  const saved = db
    .insert(odometerReadings)
    .values({ ...reading, createdAt: now })
    .returning()
    .get();
  return { ok: true, reading: saved };
}

/** Only typed-in readings are removed here; fill-ups and services own their own readings. */
export function deleteManualReading(db: AppDatabase, carId: number, readingId: number) {
  return (
    db
      .delete(odometerReadings)
      .where(
        and(
          eq(odometerReadings.id, readingId),
          eq(odometerReadings.carId, carId),
          eq(odometerReadings.source, "manual"),
        ),
      )
      .run().changes > 0
  );
}

export function mileageFor(readings: readonly OdometerReading[], now = Date.now()) {
  return estimateMileage(
    readings.map((r) => ({ miles: r.miles, at: r.readAt })),
    now,
  );
}

/** The garage list: each car with its Mileage Clock. */
export function garage(db: AppDatabase, now = Date.now()) {
  return listCars(db).map((car) => ({ car, mileage: mileageFor(readingsFor(db, car.id), now) }));
}

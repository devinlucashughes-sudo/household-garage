import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { mileageFor, readingsFor } from "./cars";
import type { AppDatabase, QueryDatabase } from "./db";
import { dateInputValue } from "./format";
import { cars, maintenanceSchedules, serviceRecords, tires, treadReadings } from "./schema";
import { getService } from "./services";
import {
  dotMadeOn, lowestTread, REPLACE_AT_32NDS, TIRE_AGE_LIMIT_YEARS, tireInputSchema, yearsBetween,
  type TireInput, type TirePosition, type TreadDepths,
} from "./tire-input";

export type Tire = typeof tires.$inferSelect;
// Read schedules directly: importing ./maintenance here would be circular (Mark done saves tread through this module).
const maintenanceFor = (db: QueryDatabase, carId: number) => db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.carId, carId)).all();
type TireDatabase = Pick<AppDatabase, "select" | "insert" | "update" | "delete" | "transaction">;
export class TireError extends Error {
  constructor(message: string, public field?: string) { super(message); }
}

const ORDER: Record<string, number> = { lf: 0, rf: 1, lr: 2, rr: 3, spare: 4 };
const byPosition = (a: Tire, b: Tire) => (ORDER[a.position ?? ""] ?? 5) - (ORDER[b.position ?? ""] ?? 5) || a.id - b.id;

export const tiresFor = (db: QueryDatabase, carId: number) =>
  db.select().from(tires).where(eq(tires.carId, carId)).orderBy(desc(tires.installedDate), asc(tires.id)).all();

export const getTire = (db: QueryDatabase, carId: number, id: number) =>
  db.select().from(tires).where(and(eq(tires.carId, carId), eq(tires.id, id))).get() ?? null;

/** Tires on the car now, front left round to the spare; and the ones that came off, newest first. */
export function tireSets(db: QueryDatabase, carId: number) {
  const all = tiresFor(db, carId);
  return {
    current: all.filter((tire) => tire.removedDate === null).sort(byPosition),
    past: all.filter((tire) => tire.removedDate !== null).sort((a, b) => b.removedDate!.localeCompare(a.removedDate!) || byPosition(a, b)),
  };
}

function checkInput(db: QueryDatabase, carId: number, input: TireInput, now: number) {
  const parsed = tireInputSchema.safeParse(input);
  if (!parsed.success) throw new TireError(parsed.error.issues[0].message, String(parsed.error.issues[0].path[0]));
  const today = dateInputValue(now);
  if (input.installedDate > today) throw new TireError("Use the date they went on, up to today.", "installedDate");
  if (input.removedDate !== null && input.removedDate > today) throw new TireError("Use a date up to today.", "removedDate");
  if (input.serviceId !== null) {
    const service = getService(db, carId, input.serviceId);
    if (!service || service.kind !== "service") throw new TireError("Choose completed service for this car.", "serviceId");
  }
  return parsed.data;
}

/**
 * New tires at one or more positions. Whatever was on at those positions comes off the same day, so
 * the car's current set stays one tire per corner. A retry with the same key adds nothing.
 */
export function addTires(db: TireDatabase, carId: number, input: TireInput, positions: (TirePosition | null)[],
  options: { requestKey: string; createdBy?: number; now?: number }) {
  const now = options.now ?? Date.now();
  if (!options.requestKey || options.requestKey.length > 200) throw new TireError("Reload the form before saving.");
  if (positions.length === 0) throw new TireError("Tick where the new tires went on.", "positions");
  return db.transaction((tx) => {
    if (!tx.select({ id: cars.id }).from(cars).where(eq(cars.id, carId)).get()) throw new TireError("This car is no longer in the garage.");
    const values = checkInput(tx, carId, input, now);
    return positions.map((position) => {
      const requestKey = `${options.requestKey}:${position ?? "unknown"}`;
      const retry = tx.select().from(tires).where(eq(tires.requestKey, requestKey)).get();
      if (retry) {
        if (retry.carId !== carId) throw new TireError("Reload the form and try again.");
        return retry;
      }
      if (position !== null)
        tx.update(tires).set({ removedDate: values.installedDate, removedMiles: values.installedMiles, updatedAt: now })
          .where(and(eq(tires.carId, carId), eq(tires.position, position), isNull(tires.removedDate), lte(tires.installedDate, values.installedDate))).run();
      return tx.insert(tires).values({ ...values, position, removedDate: null, removedMiles: null, carId, requestKey,
        createdBy: options.createdBy, createdAt: now, updatedAt: now }).returning().get();
    });
  });
}

export function updateTire(db: TireDatabase, carId: number, id: number, revision: number, input: TireInput, now = Date.now()) {
  return db.transaction((tx) => {
    const previous = getTire(tx, carId, id);
    if (!previous) throw new TireError("This tire was deleted. Return to the tires page.");
    if (previous.revision !== revision) throw new TireError("This tire changed in another window. Open it again before saving.");
    const values = checkInput(tx, carId, input, now);
    return tx.update(tires).set({ ...values, revision: previous.revision + 1, updatedAt: now }).where(eq(tires.id, id)).returning().get();
  });
}

export function deleteTire(db: TireDatabase, carId: number, id: number, revision: number) {
  db.transaction((tx) => {
    const previous = getTire(tx, carId, id);
    if (!previous) return;
    if (previous.revision !== revision) throw new TireError("This tire changed. Open it again before deleting.");
    tx.delete(tires).where(eq(tires.id, id)).run();
  });
}

export type TireAge =
  | { kind: "dot"; madeOn: string; years: number; old: boolean }
  | { kind: "installed"; years: number };
/** Age from the DOT code when it's known; otherwise only how long it has been on the car. */
export function tireAge(tire: Pick<Tire, "dot" | "installedDate">, today: string): TireAge {
  if (tire.dot) {
    const madeOn = dotMadeOn(tire.dot, today);
    const years = yearsBetween(madeOn, today);
    return { kind: "dot", madeOn, years, old: years >= TIRE_AGE_LIMIT_YEARS };
  }
  return { kind: "installed", years: yearsBetween(tire.installedDate, today) };
}

/** A service's tread reading, or null when none was taken. */
export function treadFor(db: QueryDatabase, serviceId: number): TreadDepths | null {
  const row = db.select().from(treadReadings).where(eq(treadReadings.serviceId, serviceId)).get();
  return row ? { lf: row.lf, rf: row.rf, lr: row.lr, rr: row.rr } : null;
}

/** Save or clear a service's tread reading. Quotes never carry one. */
export function setTread(db: QueryDatabase, carId: number, serviceId: number, tread: TreadDepths | null) {
  const service = getService(db, carId, serviceId);
  if (!service) throw new TireError("This record was deleted.");
  db.delete(treadReadings).where(eq(treadReadings.serviceId, serviceId)).run();
  if (tread && service.kind === "service") db.insert(treadReadings).values({ serviceId, ...tread }).run();
}

export type TreadCheck = { serviceId: number; title: string; date: string; miles: number | null; tread: TreadDepths; lowest: number };

/** Every tread reading for the car, oldest first. */
export function treadChecks(db: QueryDatabase, carId: number): TreadCheck[] {
  return db.select({ serviceId: serviceRecords.id, title: serviceRecords.title, date: serviceRecords.date, miles: serviceRecords.miles,
    lf: treadReadings.lf, rf: treadReadings.rf, lr: treadReadings.lr, rr: treadReadings.rr })
    .from(treadReadings).innerJoin(serviceRecords, eq(serviceRecords.id, treadReadings.serviceId))
    .where(and(eq(serviceRecords.carId, carId), eq(serviceRecords.kind, "service")))
    .orderBy(asc(serviceRecords.date), asc(serviceRecords.id)).all()
    .flatMap(({ lf, rf, lr, rr, ...check }) => {
      const tread = { lf, rf, lr, rr };
      const lowest = lowestTread(tread);
      return lowest === null ? [] : [{ ...check, tread, lowest }];
    });
}

export type TreadProjection =
  | { kind: "none" }
  | { kind: "replace-now"; latest: TreadCheck }
  | { kind: "need-more"; latest: TreadCheck }
  | { kind: "steady"; latest: TreadCheck }
  | { kind: "projected"; latest: TreadCheck; wearPer10k: number; milesLeft: number; atMiles: number; date: string | null };

/** Two checks must be at least this far apart for a wear rate worth showing. */
export const MIN_PROJECTION_MILES = 1000;

/**
 * When the worst tire reaches 4/32. The wear rate is a straight line through the lowest depth at each
 * check since tires were last fitted, by mileage; the Mileage Clock turns the miles left into a date.
 */
export function projectTread(checks: readonly TreadCheck[], lastFitted: string | null, milesPerDay: number | null): TreadProjection {
  const latest = checks.at(-1);
  if (!latest) return { kind: "none" };
  if (latest.lowest <= REPLACE_AT_32NDS) return { kind: "replace-now", latest };
  const usable = checks.filter((check) => check.miles !== null && (lastFitted === null || check.date >= lastFitted));
  const span = usable.length ? usable.at(-1)!.miles! - usable[0].miles! : 0;
  if (usable.length < 2 || span < MIN_PROJECTION_MILES || latest.miles === null) return { kind: "need-more", latest };
  const meanMiles = usable.reduce((sum, c) => sum + c.miles!, 0) / usable.length;
  const meanDepth = usable.reduce((sum, c) => sum + c.lowest, 0) / usable.length;
  const slope = usable.reduce((sum, c) => sum + (c.miles! - meanMiles) * (c.lowest - meanDepth), 0) /
    usable.reduce((sum, c) => sum + (c.miles! - meanMiles) ** 2, 0);
  if (!(slope < 0)) return { kind: "steady", latest };
  const milesLeft = Math.round((latest.lowest - REPLACE_AT_32NDS) / -slope);
  const date = milesPerDay && milesPerDay > 0
    ? new Date(Date.parse(`${latest.date}T12:00:00Z`) + (milesLeft / milesPerDay) * 86_400_000).toISOString().slice(0, 10) : null;
  return { kind: "projected", latest, wearPer10k: -slope * 10_000, milesLeft, atMiles: latest.miles + milesLeft, date };
}

/** The newest install date among the tires on the car: wear before then belongs to other tires. */
export const lastFitted = (current: readonly Tire[]) =>
  current.filter((tire) => tire.position !== "spare").reduce<string | null>((latest, tire) => latest === null || tire.installedDate > latest ? tire.installedDate : latest, null);

/** Everything the tires page and the car's Plan panel show, worked out once. */
export function tireSummary(db: QueryDatabase, carId: number, now = Date.now()) {
  const sets = tireSets(db, carId);
  const checks = treadChecks(db, carId);
  const mileage = mileageFor(readingsFor(db, carId), now);
  const projection = projectTread(checks, lastFitted(sets.current), mileage.kind === "estimate" ? mileage.milesPerDay : null);
  const today = dateInputValue(now);
  const oldTires = sets.current.filter((tire) => { const age = tireAge(tire, today); return age.kind === "dot" && age.old; });
  const treadSchedule = maintenanceFor(db, carId).filter((s) => s.asksTread && s.enabled)
    .sort((a, b) => Number(/tread/i.test(b.title)) - Number(/tread/i.test(a.title)))[0] ?? null;
  return { ...sets, checks, projection, oldTires, treadSchedule, today, currentMiles: mileage.kind === "none" ? null : mileage.miles };
}

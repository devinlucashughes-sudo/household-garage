import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase, QueryDatabase } from "./db";
import { mileageFor, readingsFor } from "./cars";
import { dateInputValue, formatMiles } from "./format";
import { cars, importDrafts, maintenanceSchedules } from "./schema";
import { addReceipt, getService, saveService, ServiceError, type ServiceRecord } from "./services";
import type { ServiceInput } from "./service-input";
import type { TreadDepths } from "./tire-input";
import { setTread } from "./tires";
import { maintenanceDay, maintenanceInputSchema, type MaintenanceInput } from "./maintenance-input";

export { maintenanceInputSchema, maintenanceFromForm } from "./maintenance-input";
export type { MaintenanceInput } from "./maintenance-input";
export type MaintenanceSchedule = typeof maintenanceSchedules.$inferSelect;
type MaintenanceDatabase = Pick<AppDatabase, "select" | "insert" | "update" | "delete" | "transaction">;
export class MaintenanceError extends Error {
  constructor(message: string, public field?: string, public stale = false) { super(message); }
}

export const maintenanceFor = (db: QueryDatabase, carId: number) => db.select().from(maintenanceSchedules)
  .where(eq(maintenanceSchedules.carId, carId)).orderBy(asc(maintenanceSchedules.title), asc(maintenanceSchedules.id)).all();

export const getMaintenance = (db: QueryDatabase, carId: number, id: number) => db.select().from(maintenanceSchedules)
  .where(and(eq(maintenanceSchedules.carId, carId), eq(maintenanceSchedules.id, id))).get() ?? null;

const matchesInput = (record: MaintenanceSchedule, input: MaintenanceInput) =>
  (Object.keys(input) as (keyof MaintenanceInput)[]).every((key) => record[key] === (key === "optional" || key === "asksTread" ? input[key] ?? false : input[key]));

export function saveMaintenance(db: MaintenanceDatabase, carId: number, input: MaintenanceInput,
  options: { id?: number; revision?: number; requestKey: string; createdBy?: number; sourceDraftId?: string; now?: number }) {
  const now = options.now ?? Date.now();
  const parsed = maintenanceInputSchema.safeParse(input);
  if (!parsed.success) throw new MaintenanceError(parsed.error.issues[0].message, String(parsed.error.issues[0].path[0]));
  const normalized = parsed.data;
  if (!options.requestKey || options.requestKey.length > 200) throw new MaintenanceError("Reload the form before saving.");
  return db.transaction((tx) => {
    if (!tx.select({ id: cars.id }).from(cars).where(eq(cars.id, carId)).get())
      throw new MaintenanceError("This car is no longer in the garage.");
    const previous = options.id === undefined ? null : getMaintenance(tx, carId, options.id);
    if (options.id !== undefined && !previous) throw new MaintenanceError("This schedule was deleted. Return to the maintenance list.", undefined, true);
    if (previous && previous.revision !== options.revision) {
      // An acknowledged or ambiguous save can be retried without another revision bump.
      if (previous.revision === (options.revision ?? 0) + 1 && previous.requestKey === options.requestKey && matchesInput(previous, normalized) &&
        (options.sourceDraftId === undefined || previous.sourceDraftId === options.sourceDraftId)) return previous;
      throw new MaintenanceError("This schedule changed in another window. Your entries are still here. Open the latest schedule before saving again.", undefined, true);
    }
    if (!previous) {
      const retry = tx.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.requestKey, options.requestKey)).get();
      if (retry) {
        if (retry.carId !== carId || !matchesInput(retry, normalized) || retry.sourceDraftId !== (options.sourceDraftId ?? null))
          throw new MaintenanceError("This save key was already used for different entries. Open the saved schedule or reload the form.");
        return retry;
      }
    }
    if (normalized.baselineDate !== null && normalized.baselineDate > dateInputValue(now))
      throw new MaintenanceError("Use a baseline date up to today.", "baselineDate");
    if (normalized.lastServiceId !== null) {
      const service = getService(tx, carId, normalized.lastServiceId);
      if (!service || service.kind !== "service") throw new MaintenanceError("Choose completed service for this car. Quotes and deleted records cannot be a baseline.", "lastServiceId");
    }
    if (options.sourceDraftId !== undefined) {
      const draft = tx.select().from(importDrafts).where(eq(importDrafts.id, options.sourceDraftId)).get();
      if (!draft || draft.carId !== carId || draft.type !== "maintenance") throw new MaintenanceError("The source import does not match this car and schedule.");
    }
    const values = { ...normalized, optional: normalized.optional ?? false, asksTread: normalized.asksTread ?? false, updatedAt: now, ...(options.sourceDraftId === undefined ? {} : { sourceDraftId: options.sourceDraftId }) };
    return previous
      ? tx.update(maintenanceSchedules).set({ ...values, revision: previous.revision + 1 }).where(eq(maintenanceSchedules.id, previous.id)).returning().get()
      : tx.insert(maintenanceSchedules).values({ ...values, carId, requestKey: options.requestKey, createdBy: options.createdBy, createdAt: now }).returning().get();
  });
}

export function deleteMaintenance(db: MaintenanceDatabase, carId: number, id: number, revision: number) {
  return db.transaction((tx) => {
    const record = getMaintenance(tx, carId, id);
    if (!record) return;
    if (record.revision !== revision) throw new MaintenanceError("This schedule changed. Open the latest schedule before deleting.", undefined, true);
    tx.delete(maintenanceSchedules).where(and(eq(maintenanceSchedules.id, id), eq(maintenanceSchedules.carId, carId))).run();
  });
}

/** Add whole calendar months, clamping Jan 31 to Feb 28/29 rather than rolling into March. */
export function addCalendarMonths(day: string, months: number) {
  const [year, month, date] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}

export type MaintenanceDueState = "overdue" | "due-soon" | "upcoming" | "needs-baseline";
export type MaintenanceDue = {
  schedule: MaintenanceSchedule; state: MaintenanceDueState | null;
  dueDate: string | null; dueMiles: number | null; remainingDays: number | null; remainingMiles: number | null;
  baselineDate: string | null; baselineMiles: number | null;
  baselineSource: "service" | "manual" | "unavailable-service";
  linkedService: ServiceRecord | null; currentMiles: number | null; basis: string[];
};

/** Date-only comparisons avoid daylight-saving offsets and respect the household's calendar. */
const calendarDay = (day: string) => Date.parse(`${day}T12:00:00Z`) / 86_400_000;
export function calculateMaintenanceDue(schedule: MaintenanceSchedule, linkedService: ServiceRecord | null,
  currentMiles: number | null, today: string, mileageBasis = "Current mileage") : MaintenanceDue {
  const linked = schedule.lastServiceId !== null;
  const service = linkedService?.id === schedule.lastServiceId && linkedService.carId === schedule.carId && linkedService.kind === "service" ? linkedService : null;
  const baselineSource = linked ? service ? "service" : "unavailable-service" : "manual";
  const baselineDate = linked ? service?.date ?? null : schedule.baselineDate;
  const baselineMiles = linked ? service?.miles ?? null : schedule.baselineMiles;
  const dueDate = schedule.intervalMonths !== null && baselineDate !== null ? addCalendarMonths(baselineDate, schedule.intervalMonths) : null;
  const dueMiles = schedule.intervalMiles !== null && baselineMiles !== null ? baselineMiles + schedule.intervalMiles : null;
  const remainingDays = dueDate === null ? null : calendarDay(dueDate) - calendarDay(today);
  const remainingMiles = dueMiles === null || currentMiles === null ? null : dueMiles - currentMiles;
  const known = [remainingDays, remainingMiles].filter((v): v is number => v !== null);
  const state = !schedule.enabled ? null : known.some((v) => v <= 0) ? "overdue" :
    (remainingDays !== null && remainingDays <= 30) || (remainingMiles !== null && remainingMiles <= 500) ? "due-soon" :
      known.length ? "upcoming" : "needs-baseline";
  const basis: string[] = [];
  if (baselineSource === "service") basis.push(`Based on completed service: ${service!.title}, ${maintenanceDay(baselineDate!)}${baselineMiles === null ? "; service mileage unknown" : ` at ${formatMiles(baselineMiles)} miles`}.`);
  else if (baselineSource === "unavailable-service") basis.push("The linked record is no longer completed service for this car. Choose another service or enter a manual baseline.");
  else basis.push(`Manual baseline: ${baselineDate === null ? "date unknown" : maintenanceDay(baselineDate)}; ${baselineMiles === null ? "mileage unknown" : `${formatMiles(baselineMiles)} miles`}.`);
  if (schedule.intervalMiles !== null) {
    if (dueMiles === null) basis.push("Mileage limit unknown: add baseline mileage or link service with recorded mileage.");
    else basis.push(`Mileage limit: ${formatMiles(dueMiles)} miles (${formatMiles(baselineMiles!)} + ${formatMiles(schedule.intervalMiles)}).`);
    if (currentMiles === null) basis.push("Current mileage unknown: add an odometer reading to compare the mileage limit.");
    else basis.push(`${mileageBasis}: ${formatMiles(currentMiles)} miles${remainingMiles === null ? "." : remainingMiles <= 0 ? `; ${formatMiles(-remainingMiles)} miles at or past the limit.` : `; ${formatMiles(remainingMiles)} miles remaining.`}`);
  }
  if (schedule.intervalMonths !== null) basis.push(dueDate === null ? "Date limit unknown: add a baseline date or link completed service." :
    `Date limit: ${maintenanceDay(dueDate)} (${schedule.intervalMonths} calendar ${schedule.intervalMonths === 1 ? "month" : "months"} after baseline); ${remainingDays! <= 0 ? `${-remainingDays!} days at or past the limit` : `${remainingDays} days remaining`}.`);
  basis.push(schedule.enabled ? "The first known limit reached determines when this is due. Due soon means within 500 miles or 30 days. Unknown limits may become due earlier." : "Disabled: excluded from due lists until enabled.");
  return { schedule, state, dueDate, dueMiles, remainingDays, remainingMiles, baselineDate, baselineMiles, baselineSource, linkedService: linked ? service : null, currentMiles, basis };
}

export function maintenanceDueFor(db: QueryDatabase, carId: number, now = Date.now()) {
  const mileage = mileageFor(readingsFor(db, carId), now);
  const currentMiles = mileage.kind === "none" ? null : mileage.miles;
  const mileageBasis = mileage.kind === "estimate" ? "Mileage Clock estimate" : mileage.kind === "reading" ? `Latest odometer reading (${maintenanceDay(dateInputValue(mileage.latest.at))})` : "Current mileage";
  return maintenanceFor(db, carId).map((schedule) => calculateMaintenanceDue(schedule,
    schedule.lastServiceId === null ? null : getService(db, carId, schedule.lastServiceId), currentMiles, dateInputValue(now), mileageBasis));
}

export type HouseholdMaintenanceDue = { carId: number; carName: string; due: MaintenanceDue };
export function householdMaintenanceDue(db: QueryDatabase, now = Date.now()): HouseholdMaintenanceDue[] {
  const order: Record<MaintenanceDueState, number> = { overdue: 0, "due-soon": 1, "needs-baseline": 2, upcoming: 3 };
  return db.select({ id: cars.id, nickname: cars.nickname }).from(cars).all().flatMap((car) =>
    maintenanceDueFor(db, car.id, now).filter((due) => due.state !== null).map((due) => ({ carId: car.id, carName: car.nickname, due })))
    .sort((a, b) => order[a.due.state!] - order[b.due.state!] || (a.due.dueDate ?? "9999").localeCompare(b.due.dueDate ?? "9999") || a.carName.localeCompare(b.carName) || a.due.schedule.title.localeCompare(b.due.schedule.title));
}

const scheduleInput = (record: MaintenanceSchedule): MaintenanceInput => ({
  title: record.title, intervalMiles: record.intervalMiles, intervalMonths: record.intervalMonths, baselineDate: record.baselineDate,
  baselineMiles: record.baselineMiles, lastServiceId: record.lastServiceId, enabled: record.enabled, optional: record.optional, asksTread: record.asksTread, notes: record.notes,
});

/**
 * Restart a schedule from completed work by linking it to that service record. Linking the same work
 * again is a no-op, so retries are safe. Older work than the schedule already counts from is refused.
 */
export function linkScheduleToService(db: MaintenanceDatabase, carId: number, scheduleId: number, serviceId: number,
  options: { revision?: number; now?: number } = {}) {
  return db.transaction((tx) => {
    const record = getMaintenance(tx, carId, scheduleId);
    if (!record) throw new MaintenanceError("This schedule was deleted. Return to the maintenance list.", undefined, true);
    if (record.lastServiceId === serviceId) return record;
    if (options.revision !== undefined && record.revision !== options.revision)
      throw new MaintenanceError("This schedule changed in another window. Open the latest schedule and try again.", undefined, true);
    const service = getService(tx, carId, serviceId);
    if (!service || service.kind !== "service") throw new MaintenanceError("Only completed service for this car can mark maintenance done.");
    const current = record.lastServiceId === null ? record.baselineDate : getService(tx, carId, record.lastServiceId)?.date ?? null;
    if (current !== null && service.date < current)
      throw new MaintenanceError(`"${record.title}" already counts from work on ${maintenanceDay(current)}. Use newer work, or edit the schedule.`);
    return saveMaintenance(tx, carId, { ...scheduleInput(record), lastServiceId: serviceId },
      { id: record.id, revision: record.revision, requestKey: record.requestKey, now: options.now });
  });
}

/**
 * Mark a schedule done: record the completed work, its tread depths, photos and receipts, and restart the
 * schedule from it, all together. A retry with the same key returns the same record without duplicating files.
 */
export function completeMaintenance(db: AppDatabase, carId: number, scheduleId: number, revision: number, work: ServiceInput,
  options: { requestKey: string; createdBy?: number; now?: number; files?: { name: string; bytes: Buffer }[]; tread?: TreadDepths | null }) {
  if (work.kind !== "service") throw new MaintenanceError("Only completed service can mark maintenance done.");
  return db.transaction(() => {
    const service = saveService(db, carId, work, { requestKey: options.requestKey, createdBy: options.createdBy, now: options.now });
    const schedule = linkScheduleToService(db, carId, scheduleId, service.id, { revision, now: options.now });
    if (options.tread) setTread(db, carId, service.id, options.tread);
    for (const file of options.files ?? []) {
      try { addReceipt(db, carId, service.id, file.name, file.bytes, options.now); }
      catch (error) { throw error instanceof ServiceError ? new ServiceError(`${file.name}: ${error.message}`, "photos") : error; }
    }
    return { service, schedule };
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  CAR_FIELDS,
  addReading,
  carInputSchema,
  deleteCar,
  deleteManualReading,
  getCar,
  milesSchema,
  saveCar,
  saveReference,
} from "@/lib/cars";
import { getDatabase } from "@/lib/db";
import { readingTime } from "@/lib/format";
import { referenceFromForm } from "@/lib/reference";
import { requireUser } from "@/lib/session";

/** What a form shows after a failed save: the problem, and what was typed so nothing is lost. */
export type FormState = { message?: string; values?: Record<string, string> };

const typed = (form: FormData) => {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries())
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  return values;
};

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

function carOrNotFound(id: number) {
  const car = getCar(getDatabase(), id);
  if (!car) redirect("/");
  return car;
}

export async function saveCarAction(
  carId: number | null,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  if (carId !== null) carOrNotFound(carId);
  const parsed = carInputSchema.safeParse(Object.fromEntries(CAR_FIELDS.map((f) => [f, text(form, f)])));
  if (!parsed.success) return { message: parsed.error.issues[0].message, values: typed(form) };

  // A new car can start with today's odometer.
  const odometer = carId === null ? text(form, "odometer").trim() : "";
  const miles = odometer ? milesSchema.safeParse(odometer) : null;
  if (miles && !miles.success) return { message: miles.error.issues[0].message, values: typed(form) };

  const db = getDatabase();
  const { car, lookupFailed } = await saveCar(db, parsed.data, { id: carId ?? undefined });
  if (miles?.success)
    addReading(db, { carId: car.id, miles: miles.data, readAt: Date.now(), source: "manual", createdBy: user.id });
  revalidatePath("/", "layout");
  redirect(`/cars/${car.id}${lookupFailed ? "?vin=failed" : ""}`);
}

export async function retryVinLookup(carId: number) {
  await requireUser();
  const car = carOrNotFound(carId);
  const input = carInputSchema.parse(
    Object.fromEntries(CAR_FIELDS.map((f) => [f, car[f] === null ? "" : String(car[f])])),
  );
  const { lookupFailed } = await saveCar(getDatabase(), input, { id: carId });
  revalidatePath("/", "layout");
  redirect(`/cars/${carId}${lookupFailed ? "?vin=failed" : ""}`);
}

export async function deleteCarAction(carId: number) {
  await requireUser();
  deleteCar(getDatabase(), carId);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function addReadingAction(
  carId: number,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  carOrNotFound(carId);
  const miles = milesSchema.safeParse(text(form, "miles"));
  if (!miles.success) return { message: miles.error.issues[0].message, values: typed(form) };
  const date = text(form, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { message: "Pick the date you read it.", values: typed(form) };
  const result = addReading(getDatabase(), {
    carId,
    miles: miles.data,
    readAt: readingTime(date),
    source: "manual",
    createdBy: user.id,
  });
  if (!result.ok) return { message: result.message, values: typed(form) };
  revalidatePath("/", "layout");
  redirect(`/cars/${carId}`);
}

export async function deleteReadingAction(carId: number, readingId: number) {
  await requireUser();
  deleteManualReading(getDatabase(), carId, readingId);
  revalidatePath("/", "layout");
}

export async function saveReferenceAction(
  carId: number,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  await requireUser();
  carOrNotFound(carId);
  const result = referenceFromForm(form);
  if (!result.ok) return { message: result.message, values: typed(form) };
  saveReference(getDatabase(), carId, result.reference);
  revalidatePath("/", "layout");
  redirect(`/cars/${carId}#reference`);
}

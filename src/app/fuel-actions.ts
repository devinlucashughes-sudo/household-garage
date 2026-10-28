"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getCar } from "@/lib/cars";
import { getDatabase } from "@/lib/db";
import { fuelFromForm, type FuelFormState } from "@/lib/fuel-input";
import { deleteFuel, FuelError, saveFuel } from "@/lib/fuel";
import { currentUser, requireUser } from "@/lib/session";

const expired = { message: "Your sign-in expired. Sign in in another tab, then return here and try again. Your entries are still here." };
function failure(error: unknown): FuelFormState {
  if (error instanceof FuelError) return { message: error.message, errors: error.field ? { [error.field]: error.message } : undefined };
  console.error("Fuel operation failed", error);
  return { message: "The change could not be saved. Your entries are still here. Try again." };
}

export async function saveFuelAction(carId: number | null, fuelId: number | null, _state: FuelFormState, form: FormData): Promise<FuelFormState> {
  if (!(await currentUser())) return expired;
  const user = await requireUser();
  const selected = z.coerce.number().int().positive().safeParse(carId ?? form.get("carId"));
  if (!selected.success) return { message: "Choose a car before saving.", errors: { carId: "Choose a car." } };
  const db = getDatabase();
  if (!getCar(db, selected.data)) return carId === null
    ? { message: "This car is no longer in the garage. Choose another car.", errors: { carId: "Choose a car that is still in the garage." } }
    : { message: "This car is no longer in the garage. Return to the garage before adding fuel." };
  const parsed = fuelFromForm(form);
  if (!parsed.ok) return { message: "Check the marked fields, then save again.", errors: parsed.errors };
  const requestKey = z.uuid().safeParse(form.get("requestKey"));
  const revision = z.coerce.number().int().positive().safeParse(form.get("revision"));
  if (!requestKey.success || (fuelId !== null && !revision.success)) return { message: "Reload this form before saving. Copy your entries first." };
  let id: number;
  try {
    const record = saveFuel(db, selected.data, parsed.input, { id: fuelId ?? undefined, revision: revision.success ? revision.data : undefined, requestKey: requestKey.data, createdBy: user.id });
    id = record.id;
  } catch (error) { return failure(error); }
  revalidatePath("/", "layout");
  redirect(`/cars/${selected.data}/fuel/${id}?saved=1`);
}

export async function deleteFuelAction(carId: number, fuelId: number, revision: number, _state: FuelFormState): Promise<FuelFormState> {
  void _state;
  if (!(await currentUser())) return expired;
  await requireUser();
  if (!getCar(getDatabase(), carId)) notFound();
  try { deleteFuel(getDatabase(), carId, fuelId, revision); }
  catch (error) { return failure(error); }
  revalidatePath("/", "layout");
  redirect(`/cars/${carId}/fuel`);
}

"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getCar } from "@/lib/cars";
import { getDatabase } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { tireFromForm, type TireFormState } from "@/lib/tire-input";
import { addTires, deleteTire, TireError, updateTire } from "@/lib/tires";

function failure(error: unknown): TireFormState {
  if (error instanceof TireError) return { message: error.message, errors: error.field ? { [error.field]: error.message } : undefined };
  console.error("Tire operation failed", error);
  return { message: "The change could not be saved. Your entries are still here. Try again." };
}

/** Adding tires (tireId null) or editing one tire. */
export async function saveTireAction(carId: number, tireId: number | null, revision: number | null, _state: TireFormState, form: FormData): Promise<TireFormState> {
  const user = await requireUser();
  const db = getDatabase();
  if (!getCar(db, carId)) notFound();
  const parsed = tireFromForm(form);
  if (!parsed.ok) return { message: "Check the marked fields, then save again.", errors: parsed.errors };
  try {
    if (tireId === null) {
      const requestKey = z.uuid().safeParse(form.get("requestKey"));
      if (!requestKey.success) return { message: "Reload this form before saving." };
      addTires(db, carId, parsed.input, parsed.positions, { requestKey: requestKey.data, createdBy: user.id });
    } else updateTire(db, carId, tireId, revision ?? 0, parsed.input);
  } catch (error) { return failure(error); }
  revalidatePath("/", "layout");
  redirect(`/cars/${carId}/tires`);
}

export async function deleteTireAction(carId: number, tireId: number, revision: number, _state: TireFormState): Promise<TireFormState> {
  void _state;
  await requireUser();
  try { deleteTire(getDatabase(), carId, tireId, revision); }
  catch (error) { return failure(error); }
  revalidatePath("/", "layout");
  redirect(`/cars/${carId}/tires`);
}

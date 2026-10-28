"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDatabase } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { maintenanceFromForm, type MaintenanceFormState } from "@/lib/maintenance-input";
import { completeMaintenance, deleteMaintenance, getMaintenance, MaintenanceError, saveMaintenance } from "@/lib/maintenance";
import { MAX_RECEIPT_BYTES, MAX_RECEIPTS, serviceInputSchema } from "@/lib/service-input";
import { ServiceError } from "@/lib/services";
import { dateInputValue } from "@/lib/format";
import { treadFromForm } from "@/lib/tire-input";
import { TireError } from "@/lib/tires";

function failure(error: unknown): MaintenanceFormState {
  if (error instanceof MaintenanceError) return { message: error.message, errors: error.field ? { [error.field]: error.message } : undefined, stale: error.stale };
  if (error instanceof ServiceError || error instanceof TireError) return { message: error.message, errors: error.field ? { [error.field]: error.message } : undefined };
  console.error("Maintenance operation failed", error);
  return { message: "The change could not be saved. Your entries are still here. Try again with this form." };
}

export async function saveMaintenanceAction(carId: number, maintenanceId: number | null, _state: MaintenanceFormState, form: FormData): Promise<MaintenanceFormState> {
  const user = await requireUser();
  const parsed = maintenanceFromForm(form);
  if (!parsed.ok) return { message: "Check the marked fields, then save again.", errors: parsed.errors };
  const requestKey = z.uuid().safeParse(form.get("requestKey"));
  const revision = z.coerce.number().int().positive().safeParse(form.get("revision"));
  if (!requestKey.success || (maintenanceId !== null && !revision.success)) return { message: "Reload this form before saving. Keep a copy of any unsaved entries." };
  let id: number;
  try {
    const saved = saveMaintenance(getDatabase(), carId, parsed.input, {
      id: maintenanceId ?? undefined, revision: revision.success ? revision.data : undefined,
      requestKey: requestKey.data, createdBy: user.id,
    });
    id = saved.id;
  } catch (error) { return failure(error); }
  revalidatePath("/", "layout");
  redirect(`/cars/${carId}/maintenance/${id}`);
}

export async function deleteMaintenanceAction(carId: number, maintenanceId: number, revision: number, _state: MaintenanceFormState): Promise<MaintenanceFormState> {
  void _state;
  await requireUser();
  try { deleteMaintenance(getDatabase(), carId, maintenanceId, revision); }
  catch (error) { return failure(error); }
  revalidatePath("/", "layout");
  redirect(`/cars/${carId}/maintenance`);
}

/** Mark a schedule done: saves the completed work as a service record and restarts the schedule from it. */
export async function completeMaintenanceAction(carId: number, maintenanceId: number, revision: number, _state: MaintenanceFormState, form: FormData): Promise<MaintenanceFormState> {
  const user = await requireUser();
  const db = getDatabase();
  const record = getMaintenance(db, carId, maintenanceId);
  if (!record) return { message: "This schedule was deleted. Return to the maintenance list.", stale: true };
  const requestKey = z.uuid().safeParse(form.get("requestKey"));
  if (!requestKey.success) return { message: "Reload this page before marking it done." };
  const text = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)) : "";
  const parsed = serviceInputSchema.safeParse({ kind: "service", title: record.title, date: text("date"), shop: text("shop"),
    miles: text("miles"), totalCents: text("totalCents"), notes: text("notes"), lineItems: [] });
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  if (text("date") > dateInputValue()) errors.date = "Use the date the work was done, up to today.";
  const uploads = form.getAll("photos").filter((file): file is File => file instanceof File && file.size > 0);
  if (uploads.length > MAX_RECEIPTS) errors.photos = `Choose up to ${MAX_RECEIPTS} photos or receipts.`;
  else if (uploads.some((file) => file.size > MAX_RECEIPT_BYTES)) errors.photos = "Each photo or receipt must be 10 MB or smaller.";
  const tread = treadFromForm(form);
  if (!tread.ok) Object.assign(errors, tread.errors);
  if (!parsed.success || Object.keys(errors).length) return { message: "Check the marked fields, then try again.", errors };
  const files = await Promise.all(uploads.map(async (file) => ({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) })));
  let serviceId: number;
  try {
    serviceId = completeMaintenance(db, carId, maintenanceId, revision, parsed.data, { requestKey: requestKey.data, createdBy: user.id, files, tread: tread.ok ? tread.tread : null }).service.id;
  } catch (error) { return failure(error); }
  revalidatePath("/", "layout");
  redirect(`/cars/${carId}/services/${serviceId}?done=${maintenanceId}`);
}

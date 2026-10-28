"use server";

import { revalidatePath } from "next/cache";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { getDatabase } from "@/lib/db";
import { getCar } from "@/lib/cars";
import { requireUser } from "@/lib/session";
import { MAX_RECEIPT_BYTES, serviceFromForm, type ServiceFormState } from "@/lib/service-input";
import { addReceipt, deleteReceipt, deleteService, getService, saveService, ServiceError } from "@/lib/services";
import { linkScheduleToService, MaintenanceError } from "@/lib/maintenance";
import { treadFromForm } from "@/lib/tire-input";
import { setTread, TireError } from "@/lib/tires";

function failure(error: unknown): ServiceFormState {
  if (error instanceof ServiceError || error instanceof TireError) return { message: error.message, errors: error.field ? { [error.field]: error.message } : undefined };
  if (error instanceof MaintenanceError) return { message: error.message, errors: { completes: error.message } };
  console.error("Service record operation failed", error);
  return { message: "The change could not be saved. Your entries are still here. Try again." };
}

export async function saveServiceAction(carId: number, serviceId: number | null, _state: ServiceFormState, form: FormData): Promise<ServiceFormState> {
  const user = await requireUser();
  const db = getDatabase();
  if (!getCar(db, carId)) notFound();
  const parsed = serviceFromForm(form);
  const tread = treadFromForm(form);
  if (!parsed.ok || !tread.ok) return { message: "Check the marked fields, then save again.", errors: { ...(parsed.ok ? {} : parsed.errors), ...(tread.ok ? {} : tread.errors) } };
  const requestKey = z.uuid().safeParse(form.get("requestKey"));
  const revision = z.coerce.number().int().positive().safeParse(form.get("revision"));
  if (!requestKey.success || (serviceId !== null && !revision.success)) return { message: "Reload this form before saving." };
  // New completed work can also mark maintenance schedules done; both are saved together.
  const completes = serviceId === null && parsed.input.kind === "service"
    ? [...new Set(form.getAll("completes").map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))] : [];
  let id: number;
  try {
    id = db.transaction(() => {
      const record = saveService(db, carId, parsed.input, {
        id: serviceId ?? undefined, revision: revision.success ? revision.data : undefined,
        requestKey: requestKey.data, createdBy: user.id,
      });
      setTread(db, carId, record.id, record.kind === "service" ? tread.tread : null);
      for (const scheduleId of completes) linkScheduleToService(db, carId, scheduleId, record.id);
      return record.id;
    });
  } catch (error) { return failure(error); }
  revalidatePath("/", "layout");
  redirect(`/cars/${carId}/services/${id}`);
}

export async function deleteServiceAction(carId: number, serviceId: number, revision: number, _state: ServiceFormState): Promise<ServiceFormState> {
  void _state;
  await requireUser();
  try { deleteService(getDatabase(), carId, serviceId, revision); }
  catch (error) { return failure(error); }
  revalidatePath("/", "layout");
  redirect(`/cars/${carId}/services`);
}

export async function uploadReceiptAction(carId: number, serviceId: number, _state: ServiceFormState, form: FormData): Promise<ServiceFormState> {
  await requireUser();
  if (!getService(getDatabase(), carId, serviceId)) notFound();
  const file = form.get("receipt");
  if (!(file instanceof File) || !file.size) return { message: "Choose a receipt first." };
  if (file.size > MAX_RECEIPT_BYTES) return { message: "Choose a receipt no larger than 10 MB." };
  try { addReceipt(getDatabase(), carId, serviceId, file.name, Buffer.from(await file.arrayBuffer())); }
  catch (error) { return failure(error); }
  revalidatePath(`/cars/${carId}/services/${serviceId}`);
  return { message: "Receipt saved." };
}

export async function deleteReceiptAction(carId: number, serviceId: number, receiptId: number) {
  await requireUser();
  deleteReceipt(getDatabase(), carId, serviceId, receiptId);
  revalidatePath(`/cars/${carId}/services/${serviceId}`);
}

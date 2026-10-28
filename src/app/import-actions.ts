"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDatabase } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { addImportReceipt, approveImport, createImportToken, editImport, getImportDraft, rejectImport, revokeImportToken, submitImport } from "@/lib/imports";
import { ImportError, type ImportState, MAX_IMPORT_BYTES } from "@/lib/import-input";
import { ServiceError } from "@/lib/services";
import { MAX_RECEIPT_BYTES, serviceFromForm } from "@/lib/service-input";
import { maintenanceFromForm } from "@/lib/maintenance-input";

const expired: ImportState = { message: "Your sign-in expired. Sign in in another tab, then return here and try again. Your entries are still here.", signInRequired: true };

function failure(error: unknown): ImportState {
  if (error instanceof ImportError || error instanceof ServiceError) return { message: error.message };
  if (error instanceof z.ZodError) return { message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ") };
  // Avoid logging secrets, source JSON or originals, including nested exception data.
  if (error instanceof Error && error.constructor.name === "MaintenanceError") return { message: error.message };
  return { message: "The change could not be saved. Your entries are still here. Try again." };
}
export async function createImportAccessAction(_state: ImportState, form: FormData): Promise<ImportState> {
  const user = await currentUser();
  if (!user) return expired;
  try {
    const token = createImportToken(getDatabase(), String(form.get("name") ?? ""), user.id);
    revalidatePath("/imports/access");
    return { secret: token.secret, success: true, message: "Desktop access created. Copy the credential now. It is shown only here, until you leave or create another." };
  } catch (error) { return failure(error); }
}
export async function revokeImportAccessAction(id: string, _state: ImportState): Promise<ImportState> {
  void _state;
  const user = await currentUser();
  if (!user) return expired;
  try { revokeImportToken(getDatabase(), id, user.id); } catch (error) { return failure(error); }
  revalidatePath("/imports/access"); return { message: "Desktop access revoked.", success: true };
}
export async function pasteImportAction(_state: ImportState, form: FormData): Promise<ImportState> {
  const user = await currentUser();
  if (!user) return expired;
  let id: string;
  try { id = submitImport(getDatabase(), String(form.get("json") ?? ""), { userId: user.id }).id; }
  catch (error) { return failure(error); }
  revalidatePath("/imports"); redirect(`/imports/${id}`);
}
export async function editImportAction(id: string, carId: number, revision: number, _state: ImportState, form: FormData): Promise<ImportState> {
  const user = await currentUser();
  if (!user) return expired;
  try {
    let value: unknown;
    if (form.get("format") === "fields") {
      const draft = getImportDraft(getDatabase(), id);
      if (!draft || draft.carId !== carId) throw new ImportError("Import not found.", 404);
      const parsed = draft.type === "service" ? serviceFromForm(form) : maintenanceFromForm(form);
      if (!parsed.ok) return { message: "Check the marked fields, then save corrections again.", errors: parsed.errors };
      value = parsed.input;
    } else {
      const text = String(form.get("json") ?? "");
      if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) throw new ImportError("JSON must be no larger than 128 KB.");
      try { value = JSON.parse(text); } catch { throw new ImportError("Enter valid JSON, then save again."); }
    }
    editImport(getDatabase(), id, carId, revision, value, user.id);
  } catch (error) { return failure(error); }
  revalidatePath(`/imports/${id}`); return { message: "Corrections saved. Review the saved details before approving.", success: true };
}
export async function reviewImportAction(id: string, carId: number, revision: number, decision: "approve" | "reject", _state: ImportState): Promise<ImportState> {
  void _state;
  const user = await currentUser();
  if (!user) return expired;
  try {
    if (decision === "approve") approveImport(getDatabase(), id, carId, revision, user.id);
    else rejectImport(getDatabase(), id, carId, revision, user.id);
  } catch (error) { return failure(error); }
  revalidatePath("/", "layout"); return { message: decision === "approve" ? "Import approved." : "Import rejected.", success: true };
}
export async function uploadImportOriginalAction(id: string, carId: number, revision: number, _state: ImportState, form: FormData): Promise<ImportState> {
  const user = await currentUser();
  if (!user) return expired;
  try {
    const file = form.get("original");
    if (!(file instanceof File) || !file.size) throw new ImportError("Choose an original first.");
    if (file.size > MAX_RECEIPT_BYTES) throw new ImportError("Choose an original no larger than 10 MB.");
    addImportReceipt(getDatabase(), id, carId, revision, file.name, Buffer.from(await file.arrayBuffer()), { userId: user.id });
  } catch (error) { return failure(error); }
  revalidatePath(`/imports/${id}`); return { message: "Original saved.", success: true };
}

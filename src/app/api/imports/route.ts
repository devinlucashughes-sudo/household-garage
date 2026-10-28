import { getDatabase } from "@/lib/db";
import { authenticateImportToken, submitImport } from "@/lib/imports";
import { ImportError, MAX_IMPORT_BYTES } from "@/lib/import-input";
import { bearer, importFailure, importResponse, readImportBody } from "@/lib/import-http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const secret = bearer(request);
    const db = getDatabase();
    authenticateImportToken(db, secret);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ImportError("Send application/json.", 415);
    const draft = submitImport(db, (await readImportBody(request, MAX_IMPORT_BYTES)).toString("utf8"), { secret });
    return importResponse({ id: draft.id, carId: draft.carId, type: draft.type, status: draft.status, revision: draft.revision }, 200);
  } catch (error) { return importFailure(error); }
}

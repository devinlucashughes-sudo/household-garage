import { getDatabase } from "@/lib/db";
import { addImportReceipt, authenticateImportToken } from "@/lib/imports";
import { ImportError } from "@/lib/import-input";
import { MAX_RECEIPT_BYTES } from "@/lib/service-input";
import { bearer, importFailure, importResponse, readImportBody } from "@/lib/import-http";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const db = getDatabase(); const secret = bearer(request); authenticateImportToken(db, secret);
    const { id } = await params;
    const url = new URL(request.url);
    const car = url.searchParams.get("carId") ?? "", revision = url.searchParams.get("revision") ?? "";
    if (!/^\d+$/.test(car) || !/^\d+$/.test(revision) || Number(car) <= 0 || Number(revision) <= 0) throw new ImportError("Provide carId and the latest draft revision.");
    let name: string;
    try { name = decodeURIComponent(request.headers.get("x-file-name") ?? "Original"); } catch { throw new ImportError("Use a URL-encoded X-File-Name header."); }
    const file = addImportReceipt(db, id, Number(car), Number(revision), name, await readImportBody(request, MAX_RECEIPT_BYTES), { secret });
    return importResponse(file);
  } catch (error) { return importFailure(error); }
}

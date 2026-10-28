import { currentUser } from "@/lib/session";
import { getDatabase } from "@/lib/db";
import { getImportReceipt } from "@/lib/imports";
import { importHeaders } from "@/lib/import-http";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string; receiptId: string }> }) {
  if (!await currentUser()) return new Response("Sign in to open this original.", { status: 401, headers: importHeaders });
  const { id, receiptId } = await params;
  if (!/^\d+$/.test(receiptId)) return new Response("Original not found.", { status: 404, headers: importHeaders });
  const file = getImportReceipt(getDatabase(), id, Number(receiptId));
  if (!file) return new Response("Original not found.", { status: 404, headers: importHeaders });
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(new Uint8Array(file.bytes), { headers: {
    ...importHeaders, "Content-Type": file.mime, "Content-Length": String(file.size),
    "Content-Disposition": `${disposition}; filename="original"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    "Content-Security-Policy": "sandbox; default-src 'none'",
  } });
}

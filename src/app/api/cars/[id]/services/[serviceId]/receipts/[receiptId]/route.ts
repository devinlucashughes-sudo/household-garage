import { currentUser } from "@/lib/session";
import { getDatabase } from "@/lib/db";
import { getReceipt } from "@/lib/services";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; serviceId: string; receiptId: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!await currentUser()) return new Response("Sign in to open this receipt.", { status: 401, headers });
  const { id, serviceId, receiptId } = await params;
  if (![id, serviceId, receiptId].every((value) => /^\d+$/.test(value))) return new Response("Receipt not found.", { status: 404, headers });
  const receipt = getReceipt(getDatabase(), Number(id), Number(serviceId), Number(receiptId));
  if (!receipt) return new Response("Receipt not found.", { status: 404, headers });
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(new Uint8Array(receipt.bytes), {
    headers: {
      ...headers,
      "Content-Type": receipt.mime,
      "Content-Length": String(receipt.size),
      "Content-Disposition": `${disposition}; filename="receipt"; filename*=UTF-8''${encodeURIComponent(receipt.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}

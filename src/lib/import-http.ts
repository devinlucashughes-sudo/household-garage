import { ImportError } from "./import-input";

export const importHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export const importResponse = (value: unknown, status = 200) => Response.json(value, { status, headers: importHeaders });
export function importFailure(error: unknown) {
  if (error instanceof ImportError) return importResponse({ error: error.message }, error.status);
  // Never log request data, Authorization headers or credentials.
  return importResponse({ error: "The import could not be saved. Retry the same requestId." }, 500);
}
export function bearer(request: Request) {
  const match = /^Bearer (hgi_[A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new ImportError("Use a valid desktop access credential.", 401);
  return match[1];
}
export async function readImportBody(request: Request, limit: number) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new ImportError("This upload is too large.", 413);
  if (!request.body) throw new ImportError("The request body is empty.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ImportError("This upload is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

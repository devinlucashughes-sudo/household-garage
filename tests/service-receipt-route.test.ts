import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "./database";
import { cars } from "@/lib/schema";
import { addReceipt, saveService } from "@/lib/services";

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/lib/session", () => ({ currentUser: async () => auth.signedIn ? { id: 1 } : null }));
vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  return { ...real, getDatabase: () => connection.db };
});
import { GET } from "@/app/api/cars/[id]/services/[serviceId]/receipts/[receiptId]/route";
let connection: ReturnType<typeof openDatabase>;
let receiptId: number;
const pdf = Buffer.from("%PDF-1.4\nOriginal bytes\n%%EOF");
beforeEach(() => {
  connection = openDatabase(":memory:"); auth.signedIn = true;
  connection.db.insert(cars).values({ id: 1, nickname: "Test car", createdAt: 1, updatedAt: 1 }).run();
  const record = saveService(connection.db, 1, { kind: "service", title: "Oil", date: "2026-01-01", shop: null, miles: null, totalCents: null, lineItems: [], notes: null }, { requestKey: "test" });
  receiptId = addReceipt(connection.db, 1, record.id, "Reçu.pdf", pdf).id;
});
afterEach(() => connection.sqlite.close());
const get = (ids: Partial<{ id: string; serviceId: string; receiptId: string }> = {}, download = false) =>
  GET(new Request(`http://localhost/api/receipt${download ? "?download=1" : ""}`), { params: Promise.resolve({ id: "1", serviceId: "1", receiptId: String(receiptId), ...ids }) });
describe("receipt download route", () => {
  it("requires a signed-in household member", async () => {
    auth.signedIn = false; const response = await get(); expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("serves original bytes with safe headers and an explicit download option", async () => {
    const response = await get(); expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("inline;");
    expect(response.headers.get("content-disposition")).toContain("Re%C3%A7u.pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await get({}, true)).headers.get("content-disposition")).toContain("attachment;");
  });
  it("does not expose a receipt under another car, record, or malformed address", async () => {
    expect((await get({ id: "2" })).status).toBe(404);
    expect((await get({ serviceId: "2" })).status).toBe(404);
    expect((await get({ receiptId: "../1" })).status).toBe(404);
  });
});

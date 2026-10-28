import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "./database";
import { cars, users } from "@/lib/schema";
import { fuelFor, getFuel, saveFuel } from "@/lib/fuel";

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/lib/session", () => ({ currentUser: async () => auth.signedIn ? { id: 1 } : null, requireUser: async () => { if (!auth.signedIn) throw new Error("SIGN_IN"); return { id: 1 }; } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT ${path}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/db", async (original) => { const real = await original<typeof import("@/lib/db")>(); return { ...real, getDatabase: () => connection.db }; });
import { deleteFuelAction, saveFuelAction } from "@/app/fuel-actions";
import { fuelFromParams } from "@/lib/fuel-page";
let connection: ReturnType<typeof openDatabase>;
const form = (changes: Record<string, string> = {}) => {
  const result = new FormData();
  for (const [key, value] of Object.entries({ carId: "1", date: "2026-01-10", miles: "10000", gallonsMilli: "12.345", totalCents: "42.19", fullTank: "on", notes: "", requestKey: randomUUID(), ...changes })) result.set(key, value);
  return result;
};
beforeEach(() => {
  connection = openDatabase(":memory:"); auth.signedIn = true;
  connection.db.insert(users).values({ id: 1, handle: "synthetic", name: "Synthetic", createdAt: 1 }).onConflictDoNothing().run();
  connection.db.insert(cars).values([{ id: 1, nickname: "Synthetic", createdAt: 1, updatedAt: 1 }, { id: 2, nickname: "Other", createdAt: 1, updatedAt: 1 }]).run();
});
afterEach(() => connection.sqlite.close());
describe("fuel actions and route access", () => {
  it("requires sign-in for save/delete and protects detail route access", async () => {
    auth.signedIn = false;
    expect(await saveFuelAction(null, null, {}, form())).toMatchObject({ message: expect.stringContaining("sign-in expired") });
    expect(await deleteFuelAction(1, 1, 1, {})).toMatchObject({ message: expect.stringContaining("sign-in expired") });
    await expect(fuelFromParams(Promise.resolve({ id: "1", fuelId: "1" }))).rejects.toThrow("SIGN_IN");
    expect(fuelFor(connection.db, 1)).toEqual([]);
  });
  it("maps errors to visible form controls and validates retry/revision fields", async () => {
    expect(await saveFuelAction(null, null, {}, form({ carId: "bogus" }))).toMatchObject({ errors: { carId: expect.any(String) } });
    expect(await saveFuelAction(null, null, {}, form({ carId: "99" }))).toMatchObject({ errors: { carId: expect.any(String) } });
    expect(await saveFuelAction(1, null, {}, form({ gallonsMilli: "", totalCents: "" }))).toMatchObject({ errors: { gallonsMilli: expect.any(String), totalCents: expect.any(String) } });
    expect(await saveFuelAction(1, null, {}, form({ requestKey: "bad" }))).toMatchObject({ message: expect.stringContaining("Reload") });
    expect(await saveFuelAction(1, 1, {}, form())).toMatchObject({ message: expect.stringContaining("Reload") });
  });
  it("uses the selected car and retries without duplicating the saved fill-up", async () => {
    const data = form({ carId: "2", totalCents: "0" });
    await expect(saveFuelAction(null, null, {}, data)).rejects.toThrow(/REDIRECT \/cars\/2\/fuel\/1\?saved=1/);
    await expect(saveFuelAction(null, null, {}, data)).rejects.toThrow(/REDIRECT \/cars\/2\/fuel\/1\?saved=1/);
    expect(fuelFor(connection.db, 1)).toEqual([]);
    expect(fuelFor(connection.db, 2)).toMatchObject([{ totalCents: 0, gallonsMilli: 12345, createdBy: 1 }]);
  });
  it("locks car-linked forms to the car in their route and checks stale edits/deletes", async () => {
    const data = form({ carId: "2" });
    await expect(saveFuelAction(1, null, {}, data)).rejects.toThrow(/REDIRECT \/cars\/1\/fuel\/1/);
    const record = fuelFor(connection.db, 1)[0];
    saveFuel(connection.db, 1, { date: record.date, miles: record.miles, totalCents: 100, gallonsMilli: record.gallonsMilli, fullTank: true, missedFillups: false, notes: null }, { id: record.id, revision: 1, requestKey: record.requestKey });
    expect(await saveFuelAction(1, record.id, {}, form({ requestKey: record.requestKey, revision: "1", notes: "Stale" }))).toMatchObject({ message: expect.stringContaining("another window") });
    expect(await deleteFuelAction(1, record.id, 1, {})).toMatchObject({ message: expect.stringContaining("changed") });
    expect(getFuel(connection.db, 1, record.id)?.totalCents).toBe(100);
  });
  it("refuses malformed and cross-car detail routes and supports a retry-safe delete", async () => {
    await expect(saveFuelAction(1, null, {}, form())).rejects.toThrow(/REDIRECT/);
    for (const params of [{ id: "2", fuelId: "1" }, { id: "1", fuelId: "../1" }, { id: "1", fuelId: "99" }]) await expect(fuelFromParams(Promise.resolve(params))).rejects.toThrow("NOT_FOUND");
    expect((await fuelFromParams(Promise.resolve({ id: "1", fuelId: "1" }))).record.id).toBe(1);
    await expect(deleteFuelAction(2, 1, 1, {})).rejects.toThrow(/REDIRECT/);
    expect(getFuel(connection.db, 1, 1)).not.toBeNull();
    await expect(deleteFuelAction(1, 1, 1, {})).rejects.toThrow(/REDIRECT/);
    await expect(deleteFuelAction(1, 1, 1, {})).rejects.toThrow(/REDIRECT/);
    expect(getFuel(connection.db, 1, 1)).toBeNull();
  });
});

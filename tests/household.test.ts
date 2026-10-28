import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import { addHouseholdUser } from "@/lib/household";
import { createSetupLink, redeemSetupLink, userForSetupLink } from "@/lib/auth";
import { users } from "@/lib/schema";

const connections: ReturnType<typeof openDatabase>[] = [];
const fresh = () => { const connection = openDatabase(":memory:"); connections.push(connection); return connection.db; };
afterEach(() => { for (const { sqlite } of connections.splice(0)) sqlite.close(); });

describe("new household setup", () => {
  it("starts without seeded accounts and creates the owner's own profile and one-use setup link", () => {
    const db = fresh();
    expect(db.select().from(users).all()).toEqual([]);
    const user = addHouseholdUser(db, " Alex ", " Alex Example ", 123);
    expect(user).toMatchObject({ handle: "alex", name: "Alex Example", createdAt: 123 });
    const token = createSetupLink(db, user.id);
    expect(userForSetupLink(db, token)?.id).toBe(user.id);
    expect(redeemSetupLink(db, token)).toBe(true);
    expect(userForSetupLink(db, token)).toBeNull();
  });

  it("does not overwrite an existing account on a duplicate or invalid request", () => {
    const db = fresh();
    addHouseholdUser(db, "alex", "Original");
    expect(() => addHouseholdUser(db, "ALEX", "Replacement")).toThrow("already exists");
    for (const handle of ["", "../alex", "two words", "a".repeat(41)]) {
      expect(() => addHouseholdUser(db, handle, "Example")).toThrow();
    }
    expect(() => addHouseholdUser(db, "sam", " ")).toThrow();
    expect(db.select().from(users).all()).toMatchObject([{ handle: "alex", name: "Original" }]);
  });
});

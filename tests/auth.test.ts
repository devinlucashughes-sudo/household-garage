import { describe, expect, it } from "vitest";
import {
  createSession,
  createSetupLink,
  endAllSessions,
  redeemSetupLink,
  saveChallenge,
  takeChallenge,
  userByHandle,
  userForSession,
  userForSetupLink,
} from "@/lib/auth";
import { openDatabase } from "./database";

const HOUR = 60 * 60 * 1000;
const fresh = () => openDatabase(":memory:").db;
const owner = (db: ReturnType<typeof fresh>) => userByHandle(db, "owner")!;

describe("household", () => {
  it("uses explicit synthetic household fixtures", () => {
    const db = fresh();
    expect(owner(db).name).toBe("Owner");
    expect(userByHandle(db, " Member ")?.name).toBe("Member");
    expect(userByHandle(db, "someone")).toBeNull();
  });
});

describe("sessions", () => {
  it("last a year, then stop", () => {
    const db = fresh();
    const now = Date.UTC(2026, 9, 26);
    const { token } = createSession(db, owner(db).id, now);
    expect(userForSession(db, token, now + 364 * 24 * HOUR)?.handle).toBe("owner");
    expect(userForSession(db, token, now + 366 * 24 * HOUR)).toBeNull();
  });

  it("reject unknown tokens and end everywhere on request", () => {
    const db = fresh();
    const { token } = createSession(db, owner(db).id);
    expect(userForSession(db, "made-up")).toBeNull();
    expect(userForSession(db, undefined)).toBeNull();
    endAllSessions(db, owner(db).id);
    expect(userForSession(db, token)).toBeNull();
  });
});

describe("setup links", () => {
  it("work once", () => {
    const db = fresh();
    const token = createSetupLink(db, owner(db).id);
    expect(userForSetupLink(db, token)?.handle).toBe("owner");
    expect(redeemSetupLink(db, token)).toBe(true);
    expect(redeemSetupLink(db, token)).toBe(false);
    expect(userForSetupLink(db, token)).toBeNull();
  });

  it("expire after a day", () => {
    const db = fresh();
    const now = Date.now();
    const token = createSetupLink(db, owner(db).id, now);
    expect(userForSetupLink(db, token, now + 23 * HOUR)).not.toBeNull();
    expect(redeemSetupLink(db, token, now + 25 * HOUR)).toBe(false);
  });

  it("replace older unused links", () => {
    const db = fresh();
    const first = createSetupLink(db, owner(db).id);
    const second = createSetupLink(db, owner(db).id);
    expect(userForSetupLink(db, first)).toBeNull();
    expect(userForSetupLink(db, second)).not.toBeNull();
  });
});

describe("challenges", () => {
  it("can be answered once, for their purpose, within five minutes", () => {
    const db = fresh();
    const now = Date.now();
    const id = saveChallenge(db, "abc", "sign-in", null, now);
    expect(takeChallenge(db, id, "register", now)).toBeNull();
    const again = saveChallenge(db, "abc", "sign-in", null, now);
    expect(takeChallenge(db, again, "sign-in", now)?.challenge).toBe("abc");
    expect(takeChallenge(db, again, "sign-in", now)).toBeNull();
    const late = saveChallenge(db, "abc", "sign-in", null, now);
    expect(takeChallenge(db, late, "sign-in", now + 6 * 60 * 1000)).toBeNull();
  });
});

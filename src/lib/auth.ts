import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { AppDatabase } from "./db";
import { challenges, passkeys, sessions, setupLinks, users } from "./schema";

export const SESSION_COOKIE = "garage_session";
export const CHALLENGE_COOKIE = "garage_challenge";
/** Browsers cap cookie lifetimes at 400 days; a year keeps each device signed in. */
export const SESSION_DAYS = 365;
export const SETUP_LINK_HOURS = 24;
const CHALLENGE_MINUTES = 5;
const DAY = 24 * 60 * 60 * 1000;

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

export type User = typeof users.$inferSelect;

// Sessions

export function createSession(db: AppDatabase, userId: number, now = Date.now()) {
  const token = newToken();
  const expiresAt = now + SESSION_DAYS * DAY;
  db.insert(sessions)
    .values({ tokenHash: hashToken(token), userId, createdAt: now, expiresAt })
    .run();
  return { token, expiresAt };
}

export function userForSession(
  db: AppDatabase,
  token: string | undefined,
  now = Date.now(),
): User | null {
  if (!token) return null;
  const row = db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)),
    )
    .get();
  return row?.user ?? null;
}

export function endSession(db: AppDatabase, token: string | undefined) {
  if (token) db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}

/** Signs a person out on every device. */
export function endAllSessions(db: AppDatabase, userId: number) {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

// Setup links

export function userByHandle(db: AppDatabase, handle: string) {
  return db.select().from(users).where(eq(users.handle, handle.trim().toLowerCase())).get() ?? null;
}

/** Makes a one-time link that lets this person add a passkey. Older unused links stop working. */
export function createSetupLink(db: AppDatabase, userId: number, now = Date.now()) {
  const token = newToken();
  db.transaction((tx) => {
    tx.delete(setupLinks)
      .where(and(eq(setupLinks.userId, userId), isNull(setupLinks.usedAt)))
      .run();
    tx.insert(setupLinks)
      .values({
        tokenHash: hashToken(token),
        userId,
        expiresAt: now + SETUP_LINK_HOURS * 60 * 60 * 1000,
      })
      .run();
  });
  return token;
}

/** The person a setup link is for, if it is unused and unexpired. Does not use it up. */
export function userForSetupLink(db: AppDatabase, token: string, now = Date.now()) {
  const row = db
    .select({ user: users })
    .from(setupLinks)
    .innerJoin(users, eq(users.id, setupLinks.userId))
    .where(
      and(
        eq(setupLinks.tokenHash, hashToken(token)),
        isNull(setupLinks.usedAt),
        gt(setupLinks.expiresAt, now),
      ),
    )
    .get();
  return row?.user ?? null;
}

/** Marks a link used. Returns false if it was already used or has expired. */
export function redeemSetupLink(db: AppDatabase, token: string, now = Date.now()) {
  const result = db
    .update(setupLinks)
    .set({ usedAt: now })
    .where(
      and(
        eq(setupLinks.tokenHash, hashToken(token)),
        isNull(setupLinks.usedAt),
        gt(setupLinks.expiresAt, now),
      ),
    )
    .run();
  return result.changes === 1;
}

// Challenges

export function saveChallenge(
  db: AppDatabase,
  challenge: string,
  purpose: "sign-in" | "register",
  userId: number | null,
  now = Date.now(),
) {
  db.delete(challenges).where(lt(challenges.expiresAt, now)).run();
  const id = newToken();
  db.insert(challenges)
    .values({
      id,
      challenge,
      purpose,
      userId,
      expiresAt: now + CHALLENGE_MINUTES * 60 * 1000,
    })
    .run();
  return id;
}

/** Returns and deletes a challenge, so each one can be answered only once. */
export function takeChallenge(
  db: AppDatabase,
  id: string | undefined,
  purpose: "sign-in" | "register",
  now = Date.now(),
) {
  if (!id) return null;
  const row = db.select().from(challenges).where(eq(challenges.id, id)).get();
  if (!row) return null;
  db.delete(challenges).where(eq(challenges.id, id)).run();
  if (row.purpose !== purpose || row.expiresAt <= now) return null;
  return row;
}

// Passkeys

/** Friendly names for common passkey providers, from their AAGUIDs. */
const providers: Record<string, string> = {
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
};
export const passkeyLabel = (aaguid: string) => providers[aaguid] ?? "Passkey";

export function passkeysFor(db: AppDatabase, userId: number) {
  return db.select().from(passkeys).where(eq(passkeys.userId, userId)).all();
}

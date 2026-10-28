import { z } from "zod";
import type { AppDatabase } from "./db";
import { users } from "./schema";
import { userByHandle } from "./auth";

const profile = z.object({
  handle: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{0,39}$/, "Use a handle of 1 to 40 lowercase letters, numbers or hyphens, starting with a letter."),
  name: z.string().trim().min(1, "Enter a display name.").max(80),
}).strict();

/** Server access is required. This does not expose public registration. */
export function addHouseholdUser(db: AppDatabase, handle: string, name: string, now = Date.now()) {
  const value = profile.parse({ handle, name });
  if (userByHandle(db, value.handle)) throw new Error("That handle already exists. Use auth:link to set up or recover its passkey.");
  return db.insert(users).values({ ...value, createdAt: now }).returning().get();
}

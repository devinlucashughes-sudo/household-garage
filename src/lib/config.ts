import { isAbsolute } from "node:path";

export class ConfigError extends Error {}

export const isProduction = () => process.env.NODE_ENV === "production";

/** Where the database lives. Production needs an absolute path inside the volume. */
export function databasePath(env = process.env) {
  const path = env.DATABASE_PATH?.trim() || (isProduction() ? "" : "./data/garage.db");
  if (!path) throw new ConfigError("Set DATABASE_PATH.");
  if (isProduction() && !isAbsolute(path))
    throw new ConfigError("DATABASE_PATH must be an absolute path in production.");
  return path;
}

/** The address passkeys belong to. Passkeys only work at the exact origin they were made on. */
export function webAuthnSettings(env = process.env) {
  const origin = env.APP_ORIGIN?.trim() || (isProduction() ? "" : "http://localhost:3000");
  if (!origin) throw new ConfigError("Set APP_ORIGIN.");
  const url = new URL(origin);
  return { origin: url.origin, rpID: url.hostname, rpName: "Household Garage" };
}

/** Google OAuth client for Drive backups. Optional; uses the server administrator's OAuth application. */
export function googleSettings(env = process.env) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Keys for signing reminder notifications (VAPID). Absent until set on the server; reminders stay
 * off without them. The subject tells push services who is sending; the app's address is used so no
 * personal email is shared with them.
 */
export function pushSettings(env = process.env) {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const subject = env.VAPID_SUBJECT?.trim() || webAuthnSettings(env).origin;
  return { publicKey, privateKey, subject };
}

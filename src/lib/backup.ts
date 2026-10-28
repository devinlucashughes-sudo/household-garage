import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { googleSettings } from "./config";
import type { AppDatabase } from "./db";
import { DriveError, openFolder, type DriveFolder } from "./drive";
import { settings } from "./schema";

export const BACKUP_FOLDER = "Household Garage Backups";
export const LATEST = "household-garage-latest.db";
export const PREVIOUS = "household-garage-previous.db";
const INCOMING = "household-garage-incoming.db";
export const BACKUP_EVERY_DAYS = 7;

export class BackupError extends Error {}

// Settings

export function readSetting(db: AppDatabase, key: string) {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}
export function writeSetting(db: AppDatabase, key: string, value: string | null) {
  if (value === null) db.delete(settings).where(eq(settings.key, key)).run();
  else
    db.insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
}

export function backupStatus(db: AppDatabase) {
  const at = (key: string) => {
    const v = readSetting(db, key);
    return v ? Number(v) : null;
  };
  return {
    driveConnected: readSetting(db, "google_refresh_token") !== null,
    lastBackupAt: at("backup_last_at"),
    lastErrorAt: at("backup_error_at"),
    lastError: readSetting(db, "backup_error"),
  };
}

export function backupDue(lastBackupAt: number | null, now = Date.now()) {
  return lastBackupAt === null || now - lastBackupAt >= BACKUP_EVERY_DAYS * 24 * 60 * 60 * 1000;
}

// Snapshot

/** A consistent, checked copy of the live database as bytes. */
export async function snapshot(sqlite: Database.Database) {
  const path = join(tmpdir(), `garage-backup-${randomBytes(6).toString("hex")}.db`);
  try {
    await sqlite.backup(path);
    const copy = new Database(path, { fileMustExist: true });
    try {
      copy.pragma("journal_mode = DELETE");
      if (copy.pragma("integrity_check", { simple: true }) !== "ok")
        throw new BackupError("The backup copy failed its integrity check.");
    } finally {
      copy.close();
    }
    return new Uint8Array(readFileSync(path));
  } finally {
    for (const f of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`])
      rmSync(f, { force: true });
  }
}

/**
 * Keeps two copies in the folder: latest and previous. The new copy is fully uploaded before
 * anything older is touched, so a failure part way never leaves the folder without a backup.
 */
export async function rotate(folder: DriveFolder, bytes: Uint8Array) {
  for (const stale of (await folder.list()).filter((f) => f.name === INCOMING))
    await folder.remove(stale.id);
  const incoming = await folder.upload(INCOMING, bytes);
  const files = await folder.list();
  for (const old of files.filter((f) => f.name === PREVIOUS)) await folder.remove(old.id);
  for (const latest of files.filter((f) => f.name === LATEST)) await folder.rename(latest.id, PREVIOUS);
  await folder.rename(incoming.id, LATEST);
}

/** Takes a snapshot and sends it to Drive, recording the outcome for the settings page. */
export async function runBackup(
  db: AppDatabase,
  sqlite: Database.Database,
  open: typeof openFolder = openFolder,
) {
  try {
    const google = googleSettings();
    const refreshToken = readSetting(db, "google_refresh_token");
    if (!google) throw new BackupError("Google Drive isn't set up on the server yet.");
    if (!refreshToken) throw new BackupError("Google Drive isn't connected yet.");
    const bytes = await snapshot(sqlite);
    await rotate(await open(google, refreshToken, BACKUP_FOLDER), bytes);
    writeSetting(db, "backup_last_at", String(Date.now()));
    writeSetting(db, "backup_error", null);
    writeSetting(db, "backup_error_at", null);
  } catch (error) {
    const message =
      error instanceof BackupError || error instanceof DriveError
        ? error.message
        : "The backup failed for an unknown reason.";
    writeSetting(db, "backup_error", message);
    writeSetting(db, "backup_error_at", String(Date.now()));
    throw new BackupError(message);
  }
}

// Restore rehearsal

/**
 * Downloads the latest Drive copy and checks it could replace the live database: it opens,
 * passes integrity checks and can migrate to this release. Returns row counts
 * side by side (settings and sessions change after a backup, so they may differ).
 */
/** The latest backup in Drive, as bytes. */
export async function downloadLatest(db: AppDatabase, open: typeof openFolder = openFolder) {
  const google = googleSettings();
  const refreshToken = readSetting(db, "google_refresh_token");
  if (!google || !refreshToken) throw new BackupError("Google Drive isn't connected.");
  const folder = await open(google, refreshToken, BACKUP_FOLDER);
  const latest = (await folder.list()).find((f) => f.name === LATEST);
  if (!latest) throw new BackupError("There is no backup in Drive yet.");
  return folder.download(latest.id);
}

export async function checkLatestBackup(
  db: AppDatabase,
  live: Database.Database,
  open: typeof openFolder = openFolder,
) {
  return compareCopy(await downloadLatest(db, open), live);
}

const tablesOf = (sqlite: Database.Database) =>
  (
    sqlite
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);

/** Validate and upgrade a temporary copy. Original bytes and the live database stay untouched. */
export function prepareRestoreCopy(bytes: Uint8Array, live: Database.Database) {
  const path = join(tmpdir(), `garage-restore-check-${randomBytes(6).toString("hex")}.db`);
  writeFileSync(path, bytes);
  try {
    const copy = new Database(path, { fileMustExist: true });
    let rows: { table: string; backup: number; live: number }[];
    try {
      if (copy.pragma("integrity_check", { simple: true }) !== "ok")
        throw new BackupError("The backup failed its integrity check.");
      const migrationsFolder = resolve(/* turbopackIgnore: true */ "drizzle");
      const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
      const supported = readMigrationFiles({ migrationsFolder }).map((migration, index) => {
        // Git checkouts can change line endings without changing the migration's SQL.
        const sql = readFileSync(join(migrationsFolder, `${journal.entries[index].tag}.sql`), "utf8").replace(/\r\n/g, "\n");
        const hash = (text: string) => createHash("sha256").update(text).digest("hex");
        return { ...migration, hashes: new Set([migration.hash, hash(sql), hash(sql.replace(/\n/g, "\r\n"))]) };
      });
      if (!tablesOf(copy).includes("__drizzle_migrations"))
        throw new BackupError("The backup has no supported migration history.");
      const history = copy.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, id").all() as { hash: string; created_at: number }[];
      if (!history.length || history.length > supported.length || history.some((entry, index) =>
        !supported[index].hashes.has(entry.hash) || entry.created_at !== supported[index].folderMillis))
        throw new BackupError("The backup migration history is not supported by this release.");
      if ((copy.pragma("foreign_key_check") as unknown[]).length)
        throw new BackupError("The backup failed its relationship check.");
      copy.pragma("foreign_keys = ON");
      migrate(drizzle(copy), { migrationsFolder });
      copy.pragma("journal_mode = DELETE");
      if (copy.pragma("integrity_check", { simple: true }) !== "ok" || (copy.pragma("foreign_key_check") as unknown[]).length)
        throw new BackupError("The upgraded backup failed its integrity or relationship check.");
      const tables = tablesOf(copy);
      if (tables.join() !== tablesOf(live).join())
        throw new BackupError("The backup's tables don't match the live database.");
      const count = (sqlite: Database.Database, table: string) =>
        (sqlite.prepare(`SELECT count(*) AS n FROM "${table.replaceAll('"', '""')}"`).get() as { n: number }).n;
      rows = tables.map((table) => ({ table, backup: count(copy, table), live: count(live, table) }));
    } finally {
      copy.close();
    }
    return { bytes: new Uint8Array(readFileSync(path)), rows };
  } finally {
    for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) rmSync(file, { force: true });
  }
}

export function compareCopy(bytes: Uint8Array, live: Database.Database) {
  return prepareRestoreCopy(bytes, live).rows;
}

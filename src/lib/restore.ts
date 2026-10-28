import Database from "better-sqlite3";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Restoring a backup happens in two steps, so the live file is never replaced while the app has
 * it open: `restore:stage` saves a checked copy beside the database, then the next start swaps it
 * in before anything opens the database. The replaced files are moved aside, never deleted.
 */

export class RestoreError extends Error {}

export const stagedRestorePath = (databasePath: string) =>
  join(dirname(databasePath), "restore", "garage.db");

const stamp = (now: Date) => now.toISOString().replace(/[:.]/g, "-");

function checkFile(path: string) {
  try {
    const copy = new Database(path, { readonly: true, fileMustExist: true });
    try {
      return copy.pragma("integrity_check", { simple: true }) === "ok";
    } finally {
      copy.close();
    }
  } catch {
    return false;
  }
}

/** Saves a backup to be swapped in at the next start. Replaces any earlier staged copy. */
export function stageRestore(databasePath: string, bytes: Uint8Array) {
  const target = stagedRestorePath(databasePath);
  mkdirSync(dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  writeFileSync(partial, bytes);
  if (!checkFile(partial)) {
    rmSync(partial, { force: true });
    throw new RestoreError("That backup failed its integrity check. Nothing was staged.");
  }
  renameSync(partial, target);
  return target;
}

/**
 * Run at start, before the database is opened. If a restore is staged, moves the current
 * database (with its -wal and -shm files) into a new recovery folder and puts the staged copy in
 * its place. Returns the recovery folder, or null if nothing was staged.
 */
export function applyStagedRestore(databasePath: string, now = new Date()) {
  const staged = stagedRestorePath(databasePath);
  if (!existsSync(staged)) return null;
  if (!checkFile(staged)) {
    renameSync(staged, `${staged}.rejected-${stamp(now)}`);
    throw new RestoreError("The staged backup failed its integrity check. The live database was not changed.");
  }
  const recovery = join(dirname(databasePath), `recovery-${stamp(now)}`);
  mkdirSync(recovery);
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${databasePath}${suffix}`;
    if (existsSync(file)) renameSync(file, join(recovery, `garage.db${suffix}`));
  }
  renameSync(staged, databasePath);
  return recovery;
}

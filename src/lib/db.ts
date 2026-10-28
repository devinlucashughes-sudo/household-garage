import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { databasePath, isProduction } from "./config";
import * as schema from "./schema";

const migrationsFolder = resolve(/* turbopackIgnore: true */ "drizzle");

function configure(sqlite: Database.Database) {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
}

/**
 * Opens (creating if needed) and migrates a database. ":memory:" gives a fresh one for tests.
 * Migrations are additive and each runs once, so starting the app is always safe.
 */
export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  configure(sqlite);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, sqlite };
}

export type AppDatabase = ReturnType<typeof openDatabase>["db"];
export type QueryDatabase = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;

const shared = globalThis as unknown as {
  garageDatabase?: ReturnType<typeof openDatabase>;
};

/** The app's shared connection, opened on first use (never during the build). */
export function getConnection() {
  if (!shared.garageDatabase) {
    const path = databasePath();
    if (isProduction() && path === ":memory:")
      throw new Error("Production needs a real database file.");
    shared.garageDatabase = openDatabase(path);
  }
  return shared.garageDatabase;
}

export const getDatabase = () => getConnection().db;

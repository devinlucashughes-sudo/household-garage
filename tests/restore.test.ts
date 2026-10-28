import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshot } from "@/lib/backup";
import { openDatabase } from "./database";
import { applyStagedRestore, stageRestore, stagedRestorePath } from "@/lib/restore";

/** A live database file with one extra row, plus a backup taken before that row. */
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "garage-restore-"));
  const path = join(dir, "garage.db");
  const { sqlite } = openDatabase(path);
  const backup = await snapshot(sqlite);
  sqlite.prepare("INSERT INTO settings (key, value) VALUES ('after', 'backup')").run();
  sqlite.close();
  return { dir, path, backup };
}
const settingsCount = (path: string) => {
  const db = new Database(path, { readonly: true });
  try {
    return (db.prepare("SELECT count(*) AS n FROM settings").get() as { n: number }).n;
  } finally {
    db.close();
  }
};

describe("restore", () => {
  it("does nothing when nothing is staged", async () => {
    const { path } = await setup();
    expect(applyStagedRestore(path)).toBeNull();
    expect(settingsCount(path)).toBe(1);
  });

  it("swaps in the staged backup and keeps the old files", async () => {
    const { dir, path, backup } = await setup();
    stageRestore(path, backup);
    const recovery = applyStagedRestore(path)!;
    expect(settingsCount(path)).toBe(0);
    expect(settingsCount(join(recovery, "garage.db"))).toBe(1);
    expect(existsSync(stagedRestorePath(path))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.startsWith("recovery-"))).toHaveLength(1);
  });

  it("refuses a damaged backup and leaves the live database alone", async () => {
    const { path } = await setup();
    expect(() => stageRestore(path, new TextEncoder().encode("not a database"))).toThrow();
    writeFileSync(stagedRestorePath(path), "not a database");
    expect(() => applyStagedRestore(path)).toThrow();
    expect(settingsCount(path)).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { LATEST, PREVIOUS, backupDue, compareCopy, rotate, snapshot } from "@/lib/backup";
import { openDatabase } from "./database";
import type { DriveFile, DriveFolder } from "@/lib/drive";

/** An in-memory stand-in for the Drive folder. */
function fakeFolder(failUpload = false) {
  const files = new Map<string, DriveFile & { bytes: Uint8Array }>();
  let next = 1;
  const folder: DriveFolder = {
    list: async () => [...files.values()].map(({ id, name }) => ({ id, name })),
    async upload(name, bytes) {
      if (failUpload) throw new Error("network");
      const file = { id: String(next++), name, bytes };
      files.set(file.id, file);
      return { id: file.id, name };
    },
    async rename(id, name) {
      files.get(id)!.name = name;
    },
    async remove(id) {
      files.delete(id);
    },
    download: async (id) => files.get(id)!.bytes,
  };
  const byName = () =>
    Object.fromEntries([...files.values()].map((f) => [f.name, new TextDecoder().decode(f.bytes)]));
  return { folder, byName };
}
const text = (s: string) => new TextEncoder().encode(s);

describe("backup rotation", () => {
  it("keeps this week's and last week's copies", async () => {
    const { folder, byName } = fakeFolder();
    await rotate(folder, text("week 1"));
    expect(byName()).toEqual({ [LATEST]: "week 1" });
    await rotate(folder, text("week 2"));
    await rotate(folder, text("week 3"));
    expect(byName()).toEqual({ [LATEST]: "week 3", [PREVIOUS]: "week 2" });
  });

  it("leaves existing copies alone if the upload fails", async () => {
    const good = fakeFolder();
    await rotate(good.folder, text("week 1"));
    await rotate(good.folder, text("week 2"));
    const before = good.byName();
    const broken = { ...good.folder, upload: fakeFolder(true).folder.upload };
    await expect(rotate(broken, text("week 3"))).rejects.toThrow();
    expect(good.byName()).toEqual(before);
  });
});

describe("backup schedule", () => {
  it("is due weekly", () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    expect(backupDue(null, now)).toBe(true);
    expect(backupDue(now - 6 * day, now)).toBe(false);
    expect(backupDue(now - 7 * day, now)).toBe(true);
  });
});

describe("snapshot", () => {
  it("is a complete SQLite file", async () => {
    const { sqlite } = openDatabase(":memory:");
    const bytes = await snapshot(sqlite);
    expect(new TextDecoder().decode(bytes.slice(0, 15))).toBe("SQLite format 3");
  });
});

describe("restore check", () => {
  it("accepts the same supported SQL with Linux or Windows line endings", async () => {
    const { sqlite } = openDatabase(":memory:");
    try {
      const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
      for (const entry of journal.entries) {
        const sql = readFileSync(`drizzle/${entry.tag}.sql`, "utf8").replace(/\r\n/g, "\n");
        const hash = createHash("sha256").update(sql).digest("hex");
        sqlite.prepare("update __drizzle_migrations set hash = ? where created_at = ?").run(hash, entry.when);
      }
      const rows = compareCopy(await snapshot(sqlite), sqlite);
      expect(rows.find((row) => row.table === "users")).toEqual({ table: "users", backup: 2, live: 2 });
    } finally { sqlite.close(); }
  });
  it("accepts a fresh snapshot of the same database", async () => {
    const { sqlite } = openDatabase(":memory:");
    const rows = compareCopy(await snapshot(sqlite), sqlite);
    expect(rows.find((r) => r.table === "users")).toEqual({ table: "users", backup: 2, live: 2 });
  });

  it("rejects something that isn't a database", () => {
    const { sqlite } = openDatabase(":memory:");
    expect(() => compareCopy(new TextEncoder().encode("not a database"), sqlite)).toThrow();
  });
});

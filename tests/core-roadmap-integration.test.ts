import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { compareCopy, prepareRestoreCopy, snapshot } from "@/lib/backup";
import { openDatabase } from "./database";
import { saveFuel } from "@/lib/fuel";
import { approveImport, addImportReceipt, createImportToken, submitImport } from "@/lib/imports";
import { getMaintenance, maintenanceDueFor } from "@/lib/maintenance";
import { categoryTotal, reportsFor } from "@/lib/reports";
import { applyStagedRestore, stageRestore } from "@/lib/restore";
import * as schema from "@/lib/schema";
import { saveService } from "@/lib/services";
import { readingsFor } from "@/lib/cars";
import { timelineFor } from "@/lib/timeline";

const NOW = Date.UTC(2026, 9, 26, 18);
const files: string[] = [];
const connections: Database.Database[] = [];
const scratch = () => { const path = mkdtempSync(join(tmpdir(), "garage-core-integration-")); files.push(path); return path; };
const open = (path = ":memory:") => { const result = openDatabase(path); connections.push(result.sqlite); return result; };
const pdf = Buffer.from("%PDF-1.4\nSynthetic integration source\n%%EOF");
/** Rows as the parent schema had them: the kind of cost arrived later. */
const withoutCategory = (row: unknown) => { const { category, ...rest } = row as Record<string, unknown>; void category; return rest; };
const tables = ["cars", "service_records", "service_receipts", "odometer_readings", "fuel_records", "maintenance_schedules", "import_tokens", "import_drafts", "import_draft_receipts"];
const tableRows = (sqlite: Database.Database) => Object.fromEntries(tables.map((table) => [table, sqlite.prepare(`select * from ${table} order by rowid`).all()]));

afterEach(() => {
  for (const db of connections.splice(0)) if (db.open) db.close();
  for (const path of files.splice(0)) {
    if (dirname(resolve(path)) !== resolve(tmpdir()) || !basename(path).startsWith("garage-core-integration-")) throw new Error("Unexpected integration scratch path");
    rmSync(path, { recursive: true, force: true });
  }
});

describe("core roadmap integration", () => {
  it("accepts intermediate fuel and imported service backfills after same-day service then fuel", () => {
    const { db, sqlite } = open();
    db.insert(schema.cars).values({ id: 1, nickname: "Same-day test car", createdAt: NOW, updatedAt: NOW }).run();
    const first = saveService(db, 1, { kind: "service", title: "First service", date: "2026-10-05", miles: 10000, totalCents: null, shop: null, lineItems: [], notes: null }, { requestKey: randomUUID(), now: NOW });
    // Reproduce an existing service timestamp from the previous release.
    sqlite.prepare("update odometer_readings set read_at = ? where source = 'service' and source_id = ?").run(Date.UTC(2026, 9, 5, 12), first.id);
    for (const miles of [10600, 10300]) saveFuel(db, 1, { date: "2026-10-05", miles, gallonsMilli: 10000, totalCents: 3000, fullTank: true, missedFillups: false, notes: null }, { requestKey: randomUUID(), now: NOW });
    for (const miles of [10400, 10100]) {
      const draft = submitImport(db, JSON.stringify({ type: "service", carId: 1, requestId: randomUUID(), data: { kind: "service", title: "Intermediate work", date: "2026-10-05", miles } }), { userId: 1 }, NOW);
      approveImport(db, draft.id, 1, 1, 1, NOW);
    }
    const readings = readingsFor(db, 1);
    expect(readings.map((reading) => reading.miles)).toEqual([10600, 10400, 10300, 10100, 10000]);
    expect(new Set(readings.map((reading) => reading.readAt)).size).toBe(5);
  });
  it("upgrades and restores a parent-schema backup without changing its records or receipt bytes", async () => {
    const directory = scratch();
    const migrations = join(directory, "legacy-migrations"); mkdirSync(join(migrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 4);
    for (const entry of entries) copyFileSync(`drizzle/${entry.tag}.sql`, join(migrations, `${entry.tag}.sql`));
    writeFileSync(join(migrations, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    const path = join(directory, "legacy.db");
    const oldSqlite = new Database(path); connections.push(oldSqlite);
    oldSqlite.pragma("foreign_keys=ON");
    const db = drizzle(oldSqlite, { schema }); migrate(db, { migrationsFolder: migrations });
    db.insert(schema.cars).values({ id: 1, nickname: "Preserved test car", createdAt: NOW, updatedAt: NOW }).run();
    // Written as the parent schema stored them; today's code reads columns that schema doesn't have yet.
    const serviceId = oldSqlite.prepare("insert into service_records (car_id, kind, title, date, shop, miles, total_cents, line_items, notes, request_key, created_at, updated_at) values (1, 'service', 'Past repair', '2026-10-05', 'Test', 1050, 0, '[]', 'Original note', ?, ?, ?)").run(randomUUID(), NOW, NOW).lastInsertRowid;
    oldSqlite.prepare("insert into odometer_readings (car_id, miles, read_at, source, source_id, created_at) values (1, 1050, ?, 'service', ?, ?)").run(Date.UTC(2026, 9, 5, 17), serviceId, NOW);
    oldSqlite.prepare("insert into service_receipts (service_id, name, mime, size, bytes, created_at) values (?, 'original.pdf', 'application/pdf', ?, ?, ?)").run(serviceId, pdf.length, pdf, NOW);
    const preserved = Object.fromEntries(["cars", "service_records", "service_receipts", "odometer_readings"].map((table) => [table, oldSqlite.prepare(`select * from ${table}`).all()]));
    const oldBackup = await snapshot(oldSqlite);
    const originalBytes = Buffer.from(oldBackup);
    oldSqlite.close();
    const upgraded = open(path);
    for (const [table, rows] of Object.entries(preserved)) expect(upgraded.sqlite.prepare(`select * from ${table}`).all().map(withoutCategory)).toEqual(rows);
    expect(upgraded.sqlite.prepare("select category from service_records").all()).toEqual([{ category: "repairs" }]);
    for (const table of tables.filter((name) => !Object.keys(preserved).includes(name))) expect(upgraded.sqlite.prepare(`select count(*) as n from ${table}`).get()).toEqual({ n: 0 });
    expect(upgraded.sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
    const rows = compareCopy(oldBackup, upgraded.sqlite);
    expect(rows.find((row) => row.table === "service_receipts")).toEqual({ table: "service_receipts", backup: 1, live: 1 });
    expect(rows.find((row) => row.table === "fuel_records")).toEqual({ table: "fuel_records", backup: 0, live: 0 });
    const prepared = prepareRestoreCopy(oldBackup, upgraded.sqlite);
    expect(Buffer.from(oldBackup)).toEqual(originalBytes);
    const restoredPath = join(directory, "restored.db");
    stageRestore(restoredPath, prepared.bytes);
    expect(applyStagedRestore(restoredPath)).not.toBeNull();
    const restored = open(restoredPath);
    for (const [table, saved] of Object.entries(preserved)) expect(restored.sqlite.prepare(`select * from ${table}`).all().map(withoutCategory)).toEqual(saved);
    expect(restored.sqlite.prepare("select count(*) as n from __drizzle_migrations").get()).toEqual({ n: journal.entries.length });
  });

  it("rejects unsupported backup migration history without changing the live database", async () => {
    const live = open(); const unsupported = open();
    unsupported.sqlite.prepare("update __drizzle_migrations set hash = 'unsupported'").run();
    const before = live.sqlite.prepare("select * from __drizzle_migrations").all();
    expect(() => prepareRestoreCopy(unsupported.sqlite.serialize(), live.sqlite)).toThrow("migration history is not supported");
    expect(live.sqlite.prepare("select * from __drizzle_migrations").all()).toEqual(before);
    expect(() => prepareRestoreCopy(new Uint8Array([1, 2, 3]), live.sqlite)).toThrow();
  });

  it("keeps drafts isolated, approves service and schedule atomically, and restores every new kind of data", async () => {
    const { db, sqlite } = open();
    db.insert(schema.cars).values({ id: 1, nickname: "Integration test car", createdAt: NOW, updatedAt: NOW }).run();
    const access = createImportToken(db, "Integration desktop", 1, NOW);
    const serviceJson = JSON.stringify({ type: "service", carId: 1, requestId: randomUUID(), data: {
      kind: "service", title: "Imported oil service", date: "2026-10-05", miles: 1050, totalCents: 4200,
      lineItems: [{ description: "Oil", costCents: 4000 }],
    } });
    const draft = submitImport(db, serviceJson, { secret: access.secret }, NOW);
    const original = addImportReceipt(db, draft.id, 1, draft.revision, "evidence.pdf", pdf, { secret: access.secret }, NOW);
    expect(timelineFor(db, 1)).toEqual([]);
    expect(reportsFor(db).totals).toMatchObject({ knownCents: 0, count: 0 });
    expect(sqlite.prepare("select count(*) as n from odometer_readings").get()).toEqual({ n: 0 });
    const approved = approveImport(db, draft.id, 1, original.revision, 1, NOW);
    const serviceId = approved.approvedRecordId!;
    expect(approveImport(db, draft.id, 1, original.revision, 1, NOW).approvedRecordId).toBe(serviceId);
    expect(sqlite.prepare("select count(*) as n from service_records").get()).toEqual({ n: 1 });

    const scheduleDraft = submitImport(db, JSON.stringify({ type: "maintenance", carId: 1, requestId: randomUUID(), data: {
      title: "Test oil interval", intervalMiles: 1000, intervalMonths: 1, lastServiceId: serviceId,
    } }), { userId: 1 }, NOW);
    const schedule = approveImport(db, scheduleDraft.id, 1, scheduleDraft.revision, 1, NOW);
    expect(getMaintenance(db, 1, schedule.approvedRecordId!)?.sourceDraftId).toBe(scheduleDraft.id);
    const fuel = { gallonsMilli: 10000, totalCents: 3000, fullTank: true, missedFillups: false, notes: null };
    saveFuel(db, 1, { ...fuel, date: "2026-10-10", miles: 1100 }, { requestKey: randomUUID(), createdBy: 1, now: NOW });
    saveFuel(db, 1, { ...fuel, totalCents: 3500, date: "2026-10-20", miles: 1300 }, { requestKey: randomUUID(), createdBy: 1, now: NOW });
    submitImport(db, JSON.stringify({ type: "service", carId: 1, requestId: randomUUID(), data: { kind: "quote", title: "Unapproved quote", date: "2026-10-21", totalCents: 50000 } }), { userId: 1 }, NOW);
    const totals = reportsFor(db).totals;
    expect(totals).toMatchObject({ knownCents: 10700, count: 3 });
    expect(categoryTotal(totals, "fuel")).toMatchObject({ cents: 6500, count: 2 });
    expect(totals.categories.filter((total) => total.category !== "fuel")).toEqual([{ category: "maintenance", cents: 4200, count: 1, unknownCount: 0 }]);
    const timeline = timelineFor(db, 1);
    expect(timeline).toHaveLength(3);
    expect(timeline.find((row) => row.kind === "fuel" && row.date === "2026-10-20")?.mpg).toBe(20);
    expect(maintenanceDueFor(db, 1, NOW)[0]).toMatchObject({ state: "due-soon", dueDate: "2026-11-05", dueMiles: 2050 });
    const before = tableRows(sqlite);
    const directory = scratch(); const restoredPath = join(directory, "restored.db");
    writeFileSync(restoredPath, await snapshot(sqlite));
    const restored = open(restoredPath);
    expect(tableRows(restored.sqlite)).toEqual(before);
    expect(reportsFor(restored.db)).toEqual(reportsFor(db));
    expect(timelineFor(restored.db, 1)).toEqual(timeline);
    expect(restored.sqlite.pragma("foreign_key_check")).toEqual([]);
  });
});

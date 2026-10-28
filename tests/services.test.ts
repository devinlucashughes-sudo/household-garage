import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { addReading, deleteCar, getCar, mileageFor, readingsFor } from "@/lib/cars";
import { openDatabase } from "./database";
import { cars } from "@/lib/schema";
import { moneyInput, serviceFromForm, MAX_LINE_ITEMS, MAX_RECEIPT_BYTES, type ServiceInput } from "@/lib/service-input";
import { addReceipt, deleteReceipt, deleteService, getReceipt, getService, itemsFor, receiptMime, receiptsFor, saveService, servicesFor } from "@/lib/services";
import { snapshot } from "@/lib/backup";
import { applyStagedRestore, stageRestore } from "@/lib/restore";

process.env.TZ_NAME = "America/Chicago";
const NOW = Date.UTC(2026, 9, 26, 17);
const DAY = 86_400_000;
const connections: Database.Database[] = [];
const directories: string[] = [];
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), "garage-service-")); directories.push(dir); return dir; };
const fresh = (path = ":memory:") => { const connection = openDatabase(path); connections.push(connection.sqlite); return connection; };
const makeCar = (db: ReturnType<typeof openDatabase>["db"], nickname = "Test car") =>
  db.insert(cars).values({ nickname, createdAt: NOW, updatedAt: NOW }).returning().get();
const input = (changes: Partial<ServiceInput> = {}): ServiceInput => ({
  kind: "service", title: "Oil and filter change", date: "2026-10-10", shop: "Test shop", miles: 15000,
  totalCents: 9876, lineItems: [{ description: "Oil and filter", costCents: 9000 }], notes: null, ...changes,
});
const save = (db: ReturnType<typeof openDatabase>["db"], carId: number, changes: Partial<ServiceInput> = {}, options: Partial<Parameters<typeof saveService>[3]> = {}) =>
  saveService(db, carId, input(changes), { requestKey: randomUUID(), createdBy: 1, now: NOW, ...options });
const pdf = Buffer.from("%PDF-1.4\nSynthetic test receipt\n%%EOF");

afterEach(() => {
  for (const db of connections.splice(0)) if (db.open) db.close();
  for (const dir of directories.splice(0)) {
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith("garage-service-")) throw new Error("Unexpected scratch directory");
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("service form validation", () => {
  const form = (changes: Record<string, string> = {}) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ kind: "service", title: "Oil change", date: "2026-10-10", shop: "", miles: "", totalCents: "", notes: "", ...changes })) data.set(key, value);
    return data;
  };
  it("keeps unknown values separate from zero, with exact cents", () => {
    expect(moneyInput.parse("")).toBeNull();
    expect(moneyInput.parse("0")).toBe(0);
    expect(moneyInput.parse("$1,234.56")).toBe(123456);
    expect(moneyInput.parse("0.29")).toBe(29);
    expect(serviceFromForm(form({ miles: "0", totalCents: "0" }), NOW)).toMatchObject({ ok: true, input: { miles: 0, totalCents: 0, shop: null } });
    expect(serviceFromForm(form(), NOW)).toMatchObject({ ok: true, input: { miles: null, totalCents: null } });
  });
  it("refuses invalid dates, future work, bad mileage and malformed money", () => {
    for (const date of ["", "2026-02-29", "2026-04-31", "2026-10-27", "2026-1-01", "1899-01-01"]) expect(serviceFromForm(form({ date }), NOW).ok).toBe(false);
    expect(serviceFromForm(form({ date: "2024-02-29" }), NOW).ok).toBe(true);
    for (const totalCents of ["-1", "NaN", "1.234", "1,23.00", "100000000000"]) expect(serviceFromForm(form({ totalCents }), NOW).ok).toBe(false);
    for (const miles of ["-1", "2.5", "12abc", "2000001"]) expect(serviceFromForm(form({ miles }), NOW).ok).toBe(false);
    expect(serviceFromForm(form({ miles: "47,950" }), NOW)).toMatchObject({ ok: true, input: { miles: 47950 } });
  });
  it("validates line items and maps errors to their controls", () => {
    const data = form();
    data.append("itemDescription", "Oil"); data.append("itemCost", "20.29");
    data.append("itemDescription", "Labor"); data.append("itemCost", "");
    expect(serviceFromForm(data, NOW)).toMatchObject({ ok: true, input: { lineItems: [{ description: "Oil", costCents: 2029 }, { description: "Labor", costCents: null }] } });
    data.append("itemDescription", ""); data.append("itemCost", "7");
    expect(serviceFromForm(data, NOW)).toMatchObject({ ok: false, errors: { itemDescription2: expect.any(String) } });
    for (let i = 0; i < MAX_LINE_ITEMS; i++) { data.append("itemDescription", "Extra"); data.append("itemCost", ""); }
    expect(serviceFromForm(data, NOW).ok).toBe(false);
  });
});

describe("car-linked service history", () => {
  it("links records to the selected car and lists them by service date", () => {
    const { db } = fresh(); const car = makeCar(db); const other = makeCar(db, "Other car");
    const latest = save(db, car.id, { date: "2026-10-20", miles: 20000 });
    const older = save(db, car.id);
    save(db, other.id);
    expect(servicesFor(db, car.id).map((r) => r.id)).toEqual([latest.id, older.id]);
    expect(getService(db, other.id, older.id)).toBeNull();
    expect(itemsFor(older)).toEqual(input().lineItems);
    expect(mileageFor(readingsFor(db, car.id), NOW)).toMatchObject({ latest: { miles: 20000 } });
  });
  it("backfills between readings and preserves a later reading on the same day", () => {
    const { db } = fresh(); const car = makeCar(db);
    addReading(db, { carId: car.id, miles: 10000, readAt: NOW - 30 * DAY, source: "manual" }, NOW);
    addReading(db, { carId: car.id, miles: 20000, readAt: NOW, source: "manual" }, NOW);
    save(db, car.id);
    save(db, car.id, { date: "2026-10-26", miles: 19000 });
    expect(readingsFor(db, car.id).map((r) => r.miles)).toEqual([20000, 19000, 15000, 10000]);
    expect(mileageFor(readingsFor(db, car.id), NOW)).toMatchObject({ latest: { miles: 20000, at: NOW } });
  });
  it("atomically rejects inconsistent mileage on create and edit", () => {
    const { db } = fresh(); const car = makeCar(db);
    addReading(db, { carId: car.id, miles: 20000, readAt: NOW, source: "manual" }, NOW);
    expect(() => save(db, car.id, { miles: 25000 })).toThrow(/later/);
    expect(servicesFor(db, car.id)).toEqual([]);
    const record = save(db, car.id);
    addReceipt(db, car.id, record.id, "receipt.pdf", pdf);
    expect(() => save(db, car.id, { miles: 25000, title: "Invalid change" }, { id: record.id, revision: record.revision })).toThrow();
    expect(getService(db, car.id, record.id)).toEqual(record);
    expect(readingsFor(db, car.id).map((r) => r.miles)).toEqual([20000, 15000]);
    expect(receiptsFor(db, record.id)).toHaveLength(1);
  });
  it("updates, removes and restores only the service's own reading", () => {
    const { db } = fresh(); const car = makeCar(db);
    addReading(db, { carId: car.id, miles: 20000, readAt: NOW, source: "manual" }, NOW);
    let record = save(db, car.id);
    record = save(db, car.id, { miles: 16000 }, { id: record.id, revision: record.revision });
    expect(readingsFor(db, car.id).map((r) => r.miles)).toEqual([20000, 16000]);
    record = save(db, car.id, { miles: null }, { id: record.id, revision: record.revision });
    expect(readingsFor(db, car.id).map((r) => r.miles)).toEqual([20000]);
    record = save(db, car.id, { miles: 17000 }, { id: record.id, revision: record.revision });
    deleteService(db, car.id, record.id, record.revision);
    expect(readingsFor(db, car.id).map((r) => r.miles)).toEqual([20000]);
  });
  it("keeps quotes separate and converts one record with its receipt intact", () => {
    const { db } = fresh(); const car = makeCar(db);
    const quote = save(db, car.id, { kind: "quote" });
    const receipt = addReceipt(db, car.id, quote.id, "quote.pdf", pdf);
    expect(servicesFor(db, car.id)).toEqual([]);
    expect(servicesFor(db, car.id, "quote")).toHaveLength(1);
    expect(readingsFor(db, car.id)).toEqual([]);
    const completed = save(db, car.id, { date: "2026-10-26", totalCents: 10000 }, { id: quote.id, revision: quote.revision });
    expect(completed.id).toBe(quote.id);
    expect(servicesFor(db, car.id, "quote")).toEqual([]);
    expect(servicesFor(db, car.id)).toHaveLength(1);
    expect(readingsFor(db, car.id)).toHaveLength(1);
    expect(getReceipt(db, car.id, completed.id, receipt.id)?.bytes).toEqual(pdf);
  });
  it("rejects stale edits and deletions without overwriting a newer record", () => {
    const { db } = fresh(); const car = makeCar(db); const first = save(db, car.id);
    const updated = save(db, car.id, { notes: "Newer notes" }, { id: first.id, revision: first.revision });
    expect(() => save(db, car.id, { notes: "Old tab" }, { id: first.id, revision: first.revision })).toThrow(/another window/);
    expect(() => deleteService(db, car.id, first.id, first.revision)).toThrow(/changed/);
    expect(getService(db, car.id, first.id)).toEqual(updated);
  });
  it("makes a retried create safe and refuses edits through another car", () => {
    const { db } = fresh(); const car = makeCar(db); const other = makeCar(db, "Other"); const requestKey = randomUUID();
    const one = save(db, car.id, {}, { requestKey }); const two = save(db, car.id, {}, { requestKey });
    expect(two.id).toBe(one.id); expect(servicesFor(db, car.id)).toHaveLength(1); expect(readingsFor(db, car.id)).toHaveLength(1);
    expect(() => save(db, other.id, {}, { id: one.id, revision: 1 })).toThrow(/deleted/);
    expect(() => save(db, other.id, {}, { requestKey })).toThrow(/Reload/);
    deleteService(db, other.id, one.id, one.revision);
    expect(getService(db, car.id, one.id)).not.toBeNull();
  });
  it("never reuses deleted record or receipt IDs that stale controls still reference", () => {
    const { db } = fresh(); const car = makeCar(db);
    const old = save(db, car.id); const oldReceipt = addReceipt(db, car.id, old.id, "old.pdf", pdf);
    deleteService(db, car.id, old.id, old.revision);
    const replacement = save(db, car.id, { title: "Replacement record" });
    expect(replacement.id).toBeGreaterThan(old.id);
    expect(() => save(db, car.id, { title: "Stale overwrite" }, { id: old.id, revision: old.revision })).toThrow(/deleted/);
    deleteService(db, car.id, old.id, old.revision);
    expect(getService(db, car.id, replacement.id)?.title).toBe("Replacement record");
    const firstReceipt = addReceipt(db, car.id, replacement.id, "first.pdf", pdf);
    expect(firstReceipt.id).toBeGreaterThan(oldReceipt.id);
    deleteReceipt(db, car.id, replacement.id, firstReceipt.id);
    const replacementReceipt = addReceipt(db, car.id, replacement.id, "replacement.pdf", pdf);
    expect(replacementReceipt.id).toBeGreaterThan(firstReceipt.id);
    deleteReceipt(db, car.id, replacement.id, firstReceipt.id);
    expect(getReceipt(db, car.id, replacement.id, replacementReceipt.id)?.name).toBe("replacement.pdf");
  });
});

describe("service receipts", () => {
  it("stores original bytes, deduplicates retries, and scopes access and removal to the car and record", () => {
    const { db } = fresh(); const car = makeCar(db); const other = makeCar(db, "Other");
    const record = save(db, car.id); const otherRecord = save(db, car.id, { miles: null });
    const receipt = addReceipt(db, car.id, record.id, "../receipt\n.pdf", pdf);
    expect(addReceipt(db, car.id, record.id, "renamed.pdf", pdf).id).toBe(receipt.id);
    expect(getReceipt(db, car.id, record.id, receipt.id)).toMatchObject({ bytes: pdf, mime: "application/pdf", name: ".._receipt_.pdf" });
    expect(getReceipt(db, other.id, record.id, receipt.id)).toBeNull();
    expect(getReceipt(db, car.id, otherRecord.id, receipt.id)).toBeNull();
    deleteReceipt(db, other.id, record.id, receipt.id);
    expect(receiptsFor(db, record.id)).toHaveLength(1);
    deleteReceipt(db, car.id, record.id, receipt.id);
    expect(receiptsFor(db, record.id)).toHaveLength(0);
  });
  it("recognizes file signatures including HEIC, and rejects unsupported and oversize files", () => {
    const { db } = fresh(); const car = makeCar(db); const record = save(db, car.id);
    const heic = Buffer.from("000000186674797068656963000000006d69663168656963", "hex");
    expect(receiptMime(heic)).toBe("image/heic");
    const id = addReceipt(db, car.id, record.id, "photo.heic", heic).id;
    expect(getReceipt(db, car.id, record.id, id)?.bytes).toEqual(heic);
    expect(() => addReceipt(db, car.id, record.id, "fake.pdf", Buffer.from("<script>alert(1)</script>"))).toThrow(/recognized/);
    expect(() => addReceipt(db, car.id, record.id, "big.pdf", Buffer.alloc(MAX_RECEIPT_BYTES + 1))).toThrow(/10 MB/);
    for (let i = 0; i < 9; i++) addReceipt(db, car.id, record.id, `${i}.pdf`, Buffer.concat([pdf, Buffer.from(String(i))]));
    expect(() => addReceipt(db, car.id, record.id, "extra.pdf", Buffer.concat([pdf, Buffer.from("extra")]))).toThrow(/up to 10/);
    expect(receiptsFor(db, record.id)).toHaveLength(10);
  });
  it("removes receipts and service readings when their record or car is deleted", () => {
    const { db } = fresh(); const car = makeCar(db); const record = save(db, car.id);
    const receipt = addReceipt(db, car.id, record.id, "receipt.pdf", pdf);
    deleteService(db, car.id, record.id, record.revision);
    expect(getReceipt(db, car.id, record.id, receipt.id)).toBeNull();
    expect(receiptsFor(db, record.id)).toEqual([]); expect(readingsFor(db, car.id)).toEqual([]);
    const next = save(db, car.id); addReceipt(db, car.id, next.id, "receipt.pdf", pdf);
    deleteCar(db, car.id);
    expect(servicesFor(db, car.id)).toEqual([]); expect(receiptsFor(db, next.id)).toEqual([]); expect(readingsFor(db, car.id)).toEqual([]);
  });
});

describe("service migration and recovery", () => {
  it("adds service tables to the previous schema without changing cars or mileage", () => {
    const dir = scratch(); const migrationsFolder = join(dir, "migrations"); mkdirSync(join(migrationsFolder, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")); journal.entries = journal.entries.slice(0, 3);
    writeFileSync(join(migrationsFolder, "meta", "_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) copyFileSync(join("drizzle", `${entry.tag}.sql`), join(migrationsFolder, `${entry.tag}.sql`));
    const path = join(dir, "garage.db"); const prior = new Database(path);
    migrate(drizzle(prior), { migrationsFolder });
    prior.prepare("INSERT INTO cars (id, nickname, created_at, updated_at) VALUES (1, 'Existing car', ?, ?)").run(NOW, NOW);
    prior.prepare("INSERT INTO odometer_readings (car_id, miles, read_at, source, created_at) VALUES (1, 20000, ?, 'manual', ?)").run(NOW, NOW);
    prior.close();
    const { db, sqlite } = fresh(path);
    expect(getCar(db, 1)?.nickname).toBe("Existing car"); expect(readingsFor(db, 1)).toHaveLength(1);
    save(db, 1); sqlite.close();
    const reopened = fresh(path);
    expect(servicesFor(reopened.db, 1)).toHaveLength(1); expect(readingsFor(reopened.db, 1)).toHaveLength(2);
  });
  it("backs up and restores records, receipt bytes and linked mileage together", async () => {
    const dir = scratch(); const path = join(dir, "garage.db"); const live = fresh(path); const car = makeCar(live.db);
    const record = save(live.db, car.id); const receipt = addReceipt(live.db, car.id, record.id, "receipt.pdf", pdf);
    const backup = await snapshot(live.sqlite);
    deleteService(live.db, car.id, record.id, record.revision); live.sqlite.close();
    stageRestore(path, backup); applyStagedRestore(path);
    const restored = fresh(path);
    expect(getService(restored.db, car.id, record.id)).toEqual(record);
    expect(getReceipt(restored.db, car.id, record.id, receipt.id)?.bytes).toEqual(pdf);
    expect(readingsFor(restored.db, car.id)).toMatchObject([{ source: "service", sourceId: record.id, miles: 15000 }]);
  });
});

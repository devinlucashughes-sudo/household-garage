import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { guessCategory, isCostCategory, type ServiceCategory } from "@/lib/cost-categories";
import { openDatabase } from "./database";
import { parseImport } from "@/lib/import-input";
import { cars, serviceRecords } from "@/lib/schema";
import { serviceFromForm, type ServiceInput } from "@/lib/service-input";
import { getService, saveService } from "@/lib/services";

process.env.TZ_NAME = "America/Chicago";
const NOW = Date.UTC(2026, 9, 28, 17);
const connections: ReturnType<typeof openDatabase>[] = [];
const fresh = () => {
  const connection = openDatabase(":memory:"); connections.push(connection);
  connection.db.insert(cars).values({ id: 1, nickname: "Test car", createdAt: NOW, updatedAt: NOW }).run();
  return connection;
};
afterEach(() => { for (const { sqlite } of connections.splice(0)) sqlite.close(); });

/** The household's service titles when categories arrived, with the kind each was agreed to be. */
const AGREED: [string, ServiceCategory][] = [
  ["Oil change and inspection", "oil"], ["Oil leak repair", "repairs"], ["Cabin air filter (DIY)", "maintenance"], ["Oil change", "oil"],
  ["Battery", "maintenance"], ["Two rear tires", "tires"], ["Oil change and spark plugs (DIY)", "oil"], ["Coolant leak check", "repairs"],
  ["Four new tires", "tires"], ["Body and trim repair", "body"], ["Check-engine diagnosis", "repairs"], ["Front right tire", "tires"],
  ["Oil change and filters (DIY)", "oil"], ["Engine air filter and oil top-up", "maintenance"], ["Headlights (warranty)", "repairs"],
  ["Headlight repair", "repairs"], ["Shocks and bulbs", "maintenance"], ["Oil change and tire rotation", "oil"], ["Water pump and thermostat", "repairs"],
  ["Brake light bulbs", "maintenance"], ["Maintenance inspection", "maintenance"], ["Pre-delivery inspection", "maintenance"], ["Vehicle inspection", "maintenance"],
  ["Oil change and bulb (DIY)", "oil"], ["Headlights", "maintenance"], ["Transmission module", "repairs"], ["Radiator support", "repairs"],
  ["Wiper blades", "maintenance"], ["Fuel tank sensor", "repairs"], ["Brake booster and master cylinder", "repairs"], ["Tire replacement", "tires"],
  ["Wipers and brake fluid", "maintenance"], ["Front brakes (DIY)", "maintenance"], ["Oil drain plug", "repairs"], ["Tire rotation", "tires"],
  ["Oil and filter: oil-life alert plus annual maximum", "oil"], ["Wheel alignment", "tires"], ["Tread check", "tires"], ["Rear bumper dent", "body"],
];

describe("kinds of cost", () => {
  it("guesses the agreed kind for every household title, case-insensitively", () => {
    for (const [title, category] of AGREED) expect([title, guessCategory(title)]).toEqual([title, category]);
    expect(guessCategory("OIL CHANGE")).toBe("oil");
    expect(guessCategory("Something new")).toBe("maintenance");
    expect(isCostCategory("fuel")).toBe(true); expect(isCostCategory("service")).toBe(false);
  });
  it("sorts existing records in the migration exactly as the guess does", () => {
    const { db, sqlite } = fresh();
    for (const [title] of AGREED) db.insert(serviceRecords).values({ carId: 1, kind: "service", title, date: "2026-01-01", lineItems: "[]", requestKey: randomUUID(), createdAt: NOW, updatedAt: NOW }).run();
    const backfill = readFileSync(resolve("drizzle/0009_service_category.sql"), "utf8").split("--> statement-breakpoint")[1];
    sqlite.exec(backfill);
    const rows = sqlite.prepare("select title, category from service_records order by id").all() as { title: string; category: string }[];
    expect(rows.map((row) => [row.title, row.category])).toEqual(AGREED.map(([title]) => [title, guessCategory(title)]));
  });
  it("saves a chosen kind, guesses when none is given, and keeps the kind on an edit that leaves it out", () => {
    const { db } = fresh();
    const base: ServiceInput = { kind: "service", title: "Front brakes", date: "2026-10-10", shop: null, miles: null, totalCents: 100, notes: null, lineItems: [] };
    const guessed = saveService(db, 1, base, { requestKey: randomUUID(), now: NOW });
    expect(guessed.category).toBe("maintenance");
    const chosen = saveService(db, 1, { ...base, category: "repairs" }, { id: guessed.id, revision: guessed.revision, requestKey: guessed.requestKey, now: NOW });
    expect(chosen.category).toBe("repairs");
    const kept = saveService(db, 1, { ...base, title: "Front brake repair" }, { id: chosen.id, revision: chosen.revision, requestKey: chosen.requestKey, now: NOW });
    expect(getService(db, 1, kept.id)?.category).toBe("repairs");
  });
  it("reads the kind from the form and refuses one that isn't offered", () => {
    const form = (category: string) => {
      const data = new FormData();
      for (const [key, value] of Object.entries({ kind: "service", title: "Oil change", date: "2026-10-10", shop: "", miles: "", totalCents: "", notes: "", category })) data.set(key, value);
      return data;
    };
    expect(serviceFromForm(form("tires"), NOW)).toMatchObject({ ok: true, input: { category: "tires" } });
    expect(serviceFromForm(form(""), NOW)).toMatchObject({ ok: true, input: { category: undefined } });
    expect(serviceFromForm(form("fuel"), NOW)).toMatchObject({ ok: false, errors: { category: "Choose what kind of cost this is." } });
  });
  it("lets a desktop import name the kind, and guesses when it doesn't", () => {
    const wire = (data: object) => ({ type: "service", carId: 1, requestId: randomUUID(), data: { kind: "service", title: "Radiator support", date: "2026-10-01", ...data } });
    expect(parseImport(wire({ category: "body" }), NOW)).toMatchObject({ data: { category: "body" } });
    expect(parseImport(wire({}), NOW)).toMatchObject({ data: { title: "Radiator support" } });
    expect(() => parseImport(wire({ category: "fuel" }), NOW)).toThrow();
  });
});

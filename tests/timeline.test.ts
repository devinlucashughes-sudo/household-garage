import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database";
import { cars, fuelRecords, importDrafts, odometerReadings, serviceRecords } from "@/lib/schema";
import { activeGarageTab } from "@/lib/navigation";
import { timelineFor } from "@/lib/timeline";

let connection: ReturnType<typeof openDatabase>;
beforeEach(() => {
  connection = openDatabase(":memory:");
  connection.db.insert(cars).values([{ id: 1, nickname: "Test car", createdAt: 1, updatedAt: 1 }, { id: 2, nickname: "Other", createdAt: 1, updatedAt: 1 }]).run();
});
afterEach(() => connection.sqlite.close());
describe("combined timeline", () => {
  it("combines dated events for one car without counting owned readings again", () => {
    const db = connection.db;
    const service = db.insert(serviceRecords).values({ carId: 1, kind: "service", title: "Free work", date: "2026-10-10", miles: 1000, totalCents: 0, lineItems: "[]", requestKey: randomUUID(), createdAt: 1, updatedAt: 1 }).returning().get();
    db.insert(serviceRecords).values({ carId: 1, kind: "quote", title: "Proposed work", date: "2026-10-11", totalCents: null, lineItems: "[]", requestKey: randomUUID(), createdAt: 1, updatedAt: 1 }).run();
    db.insert(serviceRecords).values({ carId: 2, kind: "service", title: "Other car work", date: "2026-10-12", lineItems: "[]", requestKey: randomUUID(), createdAt: 1, updatedAt: 1 }).run();
    const fill = db.insert(fuelRecords).values({ carId: 1, date: "2026-10-12", miles: 1100, gallonsMilli: 10000, totalCents: 3000, fullTank: true, requestKey: randomUUID(), createdAt: 1, updatedAt: 1 }).returning().get();
    db.insert(odometerReadings).values([
      { carId: 1, miles: 1000, readAt: Date.parse("2026-10-10T12:00Z"), source: "service", sourceId: service.id, createdAt: 1 },
      { carId: 1, miles: 1100, readAt: Date.parse("2026-10-12T12:00Z"), source: "fill-up", sourceId: fill.id, createdAt: 1 },
      { carId: 1, miles: 1200, readAt: Date.parse("2026-10-13T12:00Z"), source: "manual", createdAt: 1 },
    ]).run();
    db.insert(importDrafts).values({ id: randomUUID(), carId: 1, type: "service", payload: "{}", payloadHash: "hash", idempotencyKey: randomUUID(), createdAt: 1, updatedAt: 1 }).run();
    const rows = timelineFor(db, 1);
    expect(rows.map((r) => r.kind)).toEqual(["reading", "fuel", "quote", "service"]);
    expect(rows.at(-1)).toMatchObject({ costCents: 0, title: "Free work" });
    expect(rows[2]).toMatchObject({ costCents: null, kind: "quote" });
    expect(timelineFor(db, 1, "fuel")).toHaveLength(1);
    expect(timelineFor(db, 2)).toHaveLength(1);
    expect(() => timelineFor(db, 1, "bad" as "all")).toThrow();
  });
  it("uses household calendar dates for manual readings around UTC midnight", () => {
    process.env.TZ_NAME = "America/Chicago";
    connection.db.insert(odometerReadings).values({ carId: 1, miles: 100, readAt: Date.parse("2026-10-11T02:00Z"), source: "manual", createdAt: 1 }).run();
    expect(timelineFor(connection.db, 1)[0].date).toBe("2026-10-10");
  });
});
describe("main navigation", () => {
  it("selects exactly the matching feature for car-scoped pages", () => {
    expect(activeGarageTab("/cars/1/fuel/4/edit")).toBe("fuel");
    expect(activeGarageTab("/cars/2/maintenance/new")).toBe("maintenance");
    expect(activeGarageTab("/cars/1/costs")).toBe("reports");
    expect(activeGarageTab("/imports/access")).toBe("settings");
    expect(activeGarageTab("/cars/1/timeline")).toBe("garage");
  });
});

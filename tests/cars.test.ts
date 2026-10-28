import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addReading,
  carInputSchema,
  deleteCar,
  deleteManualReading,
  garage,
  getCar,
  milesSchema,
  readingsFor,
  referenceOf,
  saveCar,
  saveReference,
  vinDetailsOf,
} from "@/lib/cars";
import { openDatabase } from "./database";
import { parseReference, referenceFromForm, referenceLines } from "@/lib/reference";

process.env.TZ_NAME = "America/Chicago";

const fresh = () => openDatabase(":memory:").db;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 26, 17);
const F150 = "1FTFW1CT0DFA00001";
const vpic = readFileSync("tests/fixtures/vpic-f150.json", "utf8");

/** A stand-in for vPIC that counts how often it's asked. */
function fakeVpic(answer: "ok" | "down" = "ok") {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(url);
    if (answer === "down") throw new Error("offline");
    return new Response(vpic);
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

const input = (fields: Partial<Record<string, string>>) =>
  carInputSchema.parse({
    nickname: "",
    year: "",
    make: "",
    model: "",
    trim: "",
    engine: "",
    color: "",
    plate: "",
    vin: "",
    notes: "",
    ...fields,
  });

describe("car input", () => {
  it("tidies the VIN and turns blanks into nothing", () => {
    const car = input({ nickname: " Truck ", vin: "1ftfw1ct0dfa00001", year: "2013" });
    expect(car).toMatchObject({ nickname: "Truck", vin: F150, year: 2013, make: null });
  });

  it("explains what's wrong in plain words", () => {
    const raw = { nickname: "x", year: "", make: "", model: "", trim: "", engine: "", color: "", plate: "", notes: "" };
    const bad = carInputSchema.safeParse({ ...raw, vin: "ABC" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].message).toMatch(/17 letters and numbers/);
    expect(carInputSchema.safeParse({ nickname: "", vin: "", year: "" }).success).toBe(false);
  });

  it("reads miles with or without commas", () => {
    expect(milesSchema.parse("47,950")).toBe(47950);
    expect(milesSchema.safeParse("47.9").success).toBe(false);
    expect(milesSchema.safeParse("").success).toBe(false);
  });
});

describe("cars", () => {
  it("looks the VIN up once and fills in the details", async () => {
    const db = fresh();
    const vpic = fakeVpic();
    const { car, lookupFailed } = await saveCar(db, input({ nickname: "Truck", vin: F150 }), {
      now: NOW,
      fetcher: vpic.fetcher,
    });
    expect(lookupFailed).toBe(false);
    expect(car).toMatchObject({ nickname: "Truck", year: 2013, make: "Ford", model: "F-150" });
    expect(vinDetailsOf(car)?.body).toBe("Pickup");
    expect(car.vinDecodedAt).toBe(NOW);

    // Correcting a detail later doesn't ask again, and the correction sticks.
    const edited = await saveCar(db, { ...input({ nickname: "Truck", vin: F150 }), model: "F-150 XLT" }, {
      id: car.id,
      fetcher: vpic.fetcher,
    });
    expect(edited.car.model).toBe("F-150 XLT");
    expect(vpic.calls).toHaveLength(1);
  });

  it("saves the car even when vPIC is down, and tries again next save", async () => {
    const db = fresh();
    const down = fakeVpic("down");
    const first = await saveCar(db, input({ nickname: "Truck", vin: F150, make: "Ford" }), {
      fetcher: down.fetcher,
    });
    expect(first.lookupFailed).toBe(true);
    expect(first.car).toMatchObject({ vin: F150, make: "Ford", vinDetails: null });

    const up = fakeVpic();
    const second = await saveCar(db, input({ nickname: "Truck", vin: F150, make: "Ford" }), {
      id: first.car.id,
      fetcher: up.fetcher,
    });
    expect(up.calls).toHaveLength(1);
    expect(second.car).toMatchObject({ year: 2013, model: "F-150" });
  });

  it("forgets the decode when the VIN is removed", async () => {
    const db = fresh();
    const { car } = await saveCar(db, input({ nickname: "Truck", vin: F150 }), {
      fetcher: fakeVpic().fetcher,
    });
    const cleared = await saveCar(db, input({ nickname: "Truck", year: "2013" }), { id: car.id });
    expect(cleared.car).toMatchObject({ vin: null, vinDetails: null, year: 2013 });
  });

  it("lists each car with its mileage, and removing a car removes its readings", async () => {
    const db = fresh();
    const { car } = await saveCar(db, input({ nickname: "Truck" }));
    addReading(db, { carId: car.id, miles: 46950, readAt: NOW - 54 * DAY, source: "manual" }, NOW);
    addReading(db, { carId: car.id, miles: 47950, readAt: NOW - 14 * DAY, source: "manual" }, NOW);
    const [entry] = garage(db, NOW);
    expect(entry.car.nickname).toBe("Truck");
    expect(entry.mileage).toMatchObject({ kind: "estimate", miles: 48300 });

    deleteCar(db, car.id);
    expect(getCar(db, car.id)).toBeNull();
    expect(readingsFor(db, car.id)).toEqual([]);
  });
});

describe("odometer readings", () => {
  it("are refused when they would run the odometer backwards or come from the future", async () => {
    const db = fresh();
    const { car } = await saveCar(db, input({ nickname: "Truck" }));
    expect(addReading(db, { carId: car.id, miles: 47950, readAt: NOW - DAY, source: "manual" }, NOW).ok).toBe(true);
    const lower = addReading(db, { carId: car.id, miles: 47000, readAt: NOW, source: "manual" }, NOW);
    expect(lower).toEqual({
      ok: false,
      message: "That's less than the 47,950 recorded on Oct 25. Check the number, or delete the wrong reading.",
    });
    const future = addReading(db, { carId: car.id, miles: 48000, readAt: NOW + DAY, source: "manual" }, NOW);
    expect(future.ok).toBe(false);
  });

  it("only typed-in readings can be deleted here", async () => {
    const db = fresh();
    const { car } = await saveCar(db, input({ nickname: "Truck" }));
    const manual = addReading(db, { carId: car.id, miles: 100, readAt: NOW - 2 * DAY, source: "manual" }, NOW);
    const fillUp = addReading(db, { carId: car.id, miles: 200, readAt: NOW - DAY, source: "fill-up", sourceId: 7 }, NOW);
    if (!manual.ok || !fillUp.ok) throw new Error("readings should save");
    expect(deleteManualReading(db, car.id, fillUp.reading.id)).toBe(false);
    expect(deleteManualReading(db, car.id, manual.reading.id)).toBe(true);
    expect(readingsFor(db, car.id).map((r) => r.source)).toEqual(["fill-up"]);
  });
});

describe("the quick-reference card", () => {
  const form = (entries: [string, string][]) => {
    const data = new FormData();
    for (const [k, v] of entries) data.append(k, v);
    return data;
  };

  it("keeps filled-in boxes and extra lines, and drops blanks", () => {
    const result = referenceFromForm(
      form([
        ["ref.oil", " 0W-20 full synthetic "],
        ["ref.oilFilter", ""],
        ["ref.tirePressureFront", "35"],
        ["ref.tirePressureRear", "35"],
        ["ref.wiperDriver", "26"],
        ["extraLabel", "Lug nut torque"],
        ["extraValue", "76 lb-ft"],
        ["extraLabel", ""],
        ["extraValue", ""],
      ]),
    );
    expect(result).toEqual({
      ok: true,
      reference: {
        values: { oil: "0W-20 full synthetic", tirePressureFront: "35", tirePressureRear: "35", wiperDriver: "26" },
        extra: [{ label: "Lug nut torque", value: "76 lb-ft" }],
      },
    });
    if (!result.ok) return;
    expect(referenceLines(result.reference)).toEqual([
      { title: "Oil and filters", lines: [{ label: "Oil", value: "0W-20 full synthetic" }] },
      { title: "Tires", lines: [{ label: "Pressure", value: "35 psi" }] },
      { title: "Wipers", lines: [{ label: "Driver", value: "26″" }] },
      { title: "Other", lines: [{ label: "Lug nut torque", value: "76 lb-ft" }] },
    ]);
  });

  it("asks for plain numbers in number boxes, and both halves of an extra line", () => {
    expect(referenceFromForm(form([["ref.tirePressureFront", "35psi"]]))).toMatchObject({ ok: false });
    expect(referenceFromForm(form([["extraLabel", "Torque"], ["extraValue", ""]]))).toMatchObject({
      ok: false,
    });
  });

  it("is stored on the car and survives odd stored data", async () => {
    const db = fresh();
    const { car } = await saveCar(db, input({ nickname: "Truck" }));
    saveReference(db, car.id, { values: { battery: "Group 35" }, extra: [] });
    expect(referenceOf(getCar(db, car.id)!).values.battery).toBe("Group 35");
    expect(parseReference("not json")).toEqual({ values: {}, extra: [] });
  });
});

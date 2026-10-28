import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fetchVinDetails,
  isVin,
  mergeDecoded,
  normalizeVin,
  parseVpic,
  tidyName,
  vinLooksWrong,
} from "@/lib/vin";

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, "utf8"));
const F150 = "1FTFW1CT0DFA00001";

describe("VINs", () => {
  it("are tidied and checked", () => {
    expect(normalizeVin(" 1ftfw1ct0-dfa 00001 ")).toBe(F150);
    expect(isVin(F150)).toBe(true);
    expect(isVin("1FTFW1CT5DFC1031")).toBe(false); // 16 characters
    expect(isVin("1FTFW1CT5DFC1031O")).toBe(false); // VINs never use O
  });

  it("make names read like names", () => {
    expect(tidyName("TOYOTA")).toBe("Toyota");
    expect(tidyName("MERCEDES-BENZ")).toBe("Mercedes-Benz");
    expect(tidyName("BMW")).toBe("BMW");
    expect(tidyName("Land Rover")).toBe("Land Rover");
  });
});

describe("reading a vPIC answer", () => {
  it("picks out the car's details", () => {
    const details = parseVpic(F150, fixture("vpic-f150"));
    expect(details).toMatchObject({
      vin: F150,
      year: 2013,
      make: "Ford",
      model: "F-150",
      trim: null,
      engine: "3.5L 6-cyl",
      body: "Pickup",
      drive: "4x2",
      fuel: "Gasoline",
      plant: "Dearborn, Michigan, United States",
      errorCode: "0",
      errorText: null,
    });
    expect(vinLooksWrong(details)).toBe(false);
  });

  it("notices a VIN that doesn't add up", () => {
    const details = parseVpic("1FTFW1CT1DFA00001", fixture("vpic-bad-check-digit"));
    expect(details.errorCode).toBe("1");
    expect(details.errorText).toMatch(/Check Digit/);
    expect(vinLooksWrong(details)).toBe(true);
  });

  it("refuses an empty answer", () => {
    expect(() => parseVpic(F150, { Results: [] })).toThrow();
  });

  it("asks vPIC once, at the decode address", async () => {
    const asked: string[] = [];
    const fetcher = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(fixture("vpic-f150")));
    }) as unknown as typeof fetch;
    const details = await fetchVinDetails(F150, fetcher);
    expect(details.model).toBe("F-150");
    expect(asked).toEqual([
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${F150}?format=json`,
    ]);
  });
});

describe("filling in from a decode", () => {
  const decoded = { year: 2013, make: "Ford", model: "F-150", trim: "XLT", engine: "3.5L 6-cyl" };

  it("fills blanks and keeps what was typed", () => {
    const merged = mergeDecoded(
      { year: null, make: "", model: "F150 SuperCrew", trim: null, engine: null },
      {},
      decoded,
    );
    expect(merged).toEqual({ ...decoded, model: "F150 SuperCrew" });
  });

  it("replaces what the last decode said, but not Owner's corrections", () => {
    const lastDecode = { year: 2012, make: "Ford", model: "Escape", trim: "SE", engine: "2.5L 4-cyl" };
    const current = { year: 2012, make: "Ford", model: "Escape", trim: "SE Sport", engine: "2.5L 4-cyl" };
    expect(mergeDecoded(current, lastDecode, decoded)).toEqual({ ...decoded, trim: "SE Sport" });
  });

  it("leaves a field alone when the decode doesn't know it", () => {
    const merged = mergeDecoded(
      { year: 2013, make: "Ford", model: "F-150", trim: "Lariat", engine: null },
      {},
      { ...decoded, trim: null, engine: null },
    );
    expect(merged.trim).toBe("Lariat");
    expect(merged.engine).toBeNull();
  });
});

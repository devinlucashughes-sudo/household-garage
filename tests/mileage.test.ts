import { describe, expect, it } from "vitest";
import { estimateMileage, readingProblem, type Reading } from "@/lib/mileage";
import { mileageLine, rateWords } from "@/lib/mileage-text";

process.env.TZ_NAME = "America/Chicago";

// Midday in Chicago, so dates read the same in any American time zone.
const day = (month: number, date: number, year = 2026) => Date.UTC(year, month - 1, date, 17);
const at = (miles: number, month: number, date: number, year?: number): Reading => ({
  miles,
  at: day(month, date, year),
});
const describe_ = (r: Reading) => `${r.miles} on ${new Date(r.at).toISOString().slice(0, 10)}`;

describe("the Mileage Clock", () => {
  it("has nothing to say with no readings", () => {
    expect(estimateMileage([], day(10, 26))).toEqual({ kind: "none" });
    expect(mileageLine({ kind: "none" }, day(10, 26))).toBe("No odometer reading yet.");
  });

  it("shows a single reading as it is, without guessing a rate", () => {
    const estimate = estimateMileage([at(47950, 10, 12)], day(10, 26));
    expect(estimate).toMatchObject({ kind: "reading", miles: 47950 });
    expect(mileageLine(estimate, day(10, 26))).toBe("47,950 · odometer reading on Oct 12");
    expect(rateWords(estimate, day(10, 26))).toMatch(/another reading at least 7 days/);
  });

  it("projects forward at the average miles per day", () => {
    // 1,000 miles over 40 days = 25 a day; 14 days later adds 350.
    const readings = [at(46950, 9, 2), at(47950, 10, 12)];
    const estimate = estimateMileage(readings, day(10, 26));
    expect(estimate).toMatchObject({ kind: "estimate", miles: 48300, milesPerDay: 25 });
    expect(mileageLine(estimate, day(10, 26))).toBe("est. 48,300 · last reading 47,950 on Oct 12");
    expect(rateWords(estimate, day(10, 26))).toBe(
      "About 25 miles a day: the average from 46,950 on Sep 2 to 47,950 on Oct 12.",
    );
  });

  it("gives the same answer whatever order the readings come in", () => {
    const readings = [at(47950, 10, 12), at(45000, 6, 1), at(46950, 9, 2), at(47500, 9, 25)];
    const shuffled = [readings[2], readings[0], readings[3], readings[1]];
    expect(estimateMileage(shuffled, day(10, 26))).toEqual(estimateMileage(readings, day(10, 26)));
    expect(estimateMileage(shuffled, day(10, 26))).toMatchObject({ latest: at(47950, 10, 12) });
  });

  it("averages over the last 90 days, ignoring older driving", () => {
    // A slow summer (10 a day), then a commute: 30 a day since Aug 1.
    const readings = [at(40000, 3, 1), at(41530, 8, 1), at(43000, 9, 19), at(43420, 10, 3)];
    const estimate = estimateMileage(readings, day(10, 3));
    expect(estimate.kind).toBe("estimate");
    if (estimate.kind !== "estimate") return;
    expect(estimate.from).toEqual(at(41530, 8, 1));
    expect(estimate.milesPerDay).toBeCloseTo(1890 / 63);
  });

  it("reaches back past 90 days when nothing recent is far enough back", () => {
    const readings = [at(40000, 1, 10), at(46000, 10, 10), at(46100, 10, 12)];
    const estimate = estimateMileage(readings, day(10, 12));
    expect(estimate).toMatchObject({ kind: "estimate", from: at(40000, 1, 10) });
  });

  it("waits for readings at least a week apart", () => {
    // A 300-mile road trip between two readings a day apart is not a daily rate.
    const estimate = estimateMileage([at(47650, 10, 11), at(47950, 10, 12)], day(10, 26));
    expect(estimate).toMatchObject({ kind: "reading", miles: 47950 });
  });

  it("never shows less than the latest reading", () => {
    // Readings that run backwards (a typo kept in the data) give no negative rate.
    const estimate = estimateMileage([at(48000, 9, 1), at(47950, 10, 12)], day(12, 1));
    expect(estimate).toMatchObject({ kind: "estimate", miles: 47950, milesPerDay: 0 });
    // A reading dated after "now" doesn't wind the clock back either.
    const early = estimateMileage([at(46950, 9, 2), at(47950, 10, 12)], day(10, 1));
    expect(early.kind !== "none" && early.miles).toBe(47950);
  });

  it("calls a fresh reading a reading, not an estimate", () => {
    const now = day(10, 26);
    const estimate = estimateMileage([at(46950, 9, 2), { miles: 48300, at: now }], now);
    expect(mileageLine(estimate, now)).toBe("48,300 · odometer reading today");
  });

  it("rounds to whole miles", () => {
    const estimate = estimateMileage([at(1000, 1, 1), at(1010, 1, 31)], day(2, 1));
    expect(estimate.kind !== "none" && estimate.miles).toBe(1010);
  });
});

describe("a new reading", () => {
  const existing = [at(46950, 9, 2), at(47950, 10, 12)];

  it("fits when the odometer only goes up", () => {
    expect(readingProblem(existing, at(48100, 10, 20), describe_)).toBeNull();
    expect(readingProblem(existing, at(47500, 9, 25), describe_)).toBeNull();
    expect(readingProblem([], at(10, 1, 1), describe_)).toBeNull();
  });

  it("can't be lower than an earlier reading", () => {
    expect(readingProblem(existing, at(47000, 10, 20), describe_)).toMatch(
      /less than the 47950 on 2026-10-12/,
    );
  });

  it("can't be higher than a later one", () => {
    expect(readingProblem(existing, at(48000, 9, 25), describe_)).toMatch(
      /more than the later 47950/,
    );
  });

  it("allows a second reading on the same day that reads higher", () => {
    expect(readingProblem(existing, { miles: 47990, at: day(10, 12) }, describe_)).toBeNull();
  });
});

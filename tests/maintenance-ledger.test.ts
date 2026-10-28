import { describe, expect, it } from "vitest";
import type { MaintenanceDue } from "@/lib/maintenance";
import { intervalWords, ledgerLine, spanWords } from "@/lib/maintenance-ledger";

const due = (changes: Partial<MaintenanceDue> & { intervalMiles?: number | null; intervalMonths?: number | null }): MaintenanceDue => {
  const { intervalMiles = null, intervalMonths = null, ...rest } = changes;
  return {
    schedule: { id: 1, carId: 1, title: "Synthetic work", intervalMiles, intervalMonths, baselineDate: null, baselineMiles: null, lastServiceId: null,
      sourceDraftId: null, enabled: true, optional: false, asksTread: false, notes: null, requestKey: "k", revision: 1, createdBy: null, createdAt: 0, updatedAt: 0 },
    state: "upcoming", dueDate: null, dueMiles: null, remainingDays: null, remainingMiles: null, baselineDate: null, baselineMiles: null,
    baselineSource: "manual", linkedService: null, currentMiles: null, basis: [], ...rest,
  };
};

describe("maintenance ledger wording", () => {
  it("says intervals and spans plainly", () => {
    expect(intervalWords(5000, null)).toBe("Every 5,000 mi");
    expect(intervalWords(null, 12)).toBe("Every 12 months");
    expect(intervalWords(15000, 12)).toBe("15,000 mi or 12 months");
    expect(spanWords(1)).toBe("1 day");
    expect(spanWords(-146)).toBe("about 5 months");
    expect(spanWords(645)).toBe("about 21 months");
    expect(spanWords(1945)).toBe("about 5 years");
  });

  it("shows the passed limit for overdue work, even when the other limit is still ahead", () => {
    const line = ledgerLine(due({ intervalMiles: 15000, intervalMonths: 12, state: "overdue", dueMiles: 194820, remainingMiles: 3006, dueDate: "2025-08-07", remainingDays: -446 }), 15);
    expect(line).toMatchObject({ limit: "by Aug 7, 2025", status: "about 15 months past", tone: "due" });
    expect(line.days).toBe(-446);
  });

  it("shows whichever limit comes first at the car's pace", () => {
    const soonByMiles = ledgerLine(due({ intervalMiles: 30000, intervalMonths: 36, dueMiles: 52570, remainingMiles: 2710, dueDate: "2027-08-07", remainingDays: 284 }), 47);
    expect(soonByMiles).toMatchObject({ limit: "at 52,570 mi", status: "2,710 mi left", tone: "ok" });
    const soonByDate = ledgerLine(due({ intervalMiles: 150000, intervalMonths: 60, dueMiles: 323938, remainingMiles: 132124, dueDate: "2028-08-02", remainingDays: 645 }), 15);
    expect(soonByDate).toMatchObject({ limit: "by Aug 2, 2028", status: "about 21 months left" });
  });

  it("names last done only when a completed service set the start", () => {
    expect(ledgerLine(due({ intervalMonths: 12, baselineSource: "service", baselineDate: "2025-06-03", dueDate: "2026-06-03", remainingDays: 30 })))
      .toMatchObject({ interval: "Every 12 months", lastDone: "last done Jun 3, 2025" });
    expect(ledgerLine(due({ intervalMonths: 12, dueDate: "2026-06-03", remainingDays: 30 })).lastDone).toBeNull();
    expect(ledgerLine(due({ intervalMonths: 12, state: "needs-baseline" }))).toMatchObject({ limit: null, status: "Needs a date", tone: "unknown" });
    expect(ledgerLine(due({ intervalMiles: 5000, state: null, dueMiles: 1000, remainingMiles: 10 }))).toMatchObject({ status: "Off", tone: "off" });
  });
});

describe("optional work", () => {
  it("sits in its own quiet group and never counts as needing attention", async () => {
    const { groupLedger, attentionCounts } = await import("@/lib/maintenance-ledger");
    const base = due({ intervalMiles: 60000, state: "overdue", dueMiles: 60007, remainingMiles: -5 });
    const optional = { ...base, schedule: { ...base.schedule, id: 2, title: "Transmission fluid", optional: true } };
    const items = [{ carId: 2, carName: "Mazda", due: base }, { carId: 2, carName: "Mazda", due: optional }];
    const groups = groupLedger(items, () => 47);
    expect(groups.map((g) => [g.key, g.items.map((i) => i.due.schedule.title)])).toEqual([["overdue", ["Synthetic work"]], ["optional", ["Transmission fluid"]]]);
    expect(groups[1].items[0].line).toMatchObject({ status: "5 mi past", tone: "off" });
    expect(attentionCounts(items)).toMatchObject({ overdue: 1, total: 1 });
  });
});

export type MpgFill = { id: number; carId: number; date: string; miles: number; gallonsMilli: number; fullTank: boolean; missedFillups: boolean };
export type MpgUnknownFuel = { carId: number; date: string };
export type FuelMpg = { id: number; carId: number; mpg: number | null; reason: "known" | "first-full" | "partial" | "missed-fill" | "no-anchor" | "no-distance"; anchorId: number | null; intervalMiles: number | null; gallonsMilli: number | null };

/** The anchor's fuel is excluded. Every partial fill and the closing full fill are included. */
export function calculateMpg(records: readonly MpgFill[], unknownFuel: readonly MpgUnknownFuel[] = []): FuelMpg[] {
  const cars = new Map<number, { anchor: MpgFill | null; gallons: number; broken: boolean }>();
  return [...records].sort((a, b) => a.date.localeCompare(b.date) || a.miles - b.miles || a.id - b.id).map((record): FuelMpg => {
    const state = cars.get(record.carId) ?? { anchor: null, gallons: 0, broken: false };
    cars.set(record.carId, state);
    // A dated budget payment has no gallons or ordering within its day. It can
    // therefore break an interval even when it shares a day with a full tank.
    if (state.anchor && unknownFuel.some((payment) => payment.carId === record.carId
      && payment.date >= state.anchor!.date && payment.date <= record.date)) {
      state.anchor = null; state.gallons = 0; state.broken = true;
    }
    if (record.missedFillups) { state.anchor = null; state.gallons = 0; state.broken = true; }
    const anchor = state.anchor;
    const gallons = state.gallons + record.gallonsMilli;
    const distance = anchor ? record.miles - anchor.miles : null;
    const reason: FuelMpg["reason"] = state.broken ? "missed-fill" : !anchor ? record.fullTank ? "first-full" : "no-anchor" : !record.fullTank ? "partial" : distance! <= 0 ? "no-distance" : "known";
    const result: FuelMpg = {
      id: record.id, carId: record.carId, reason, anchorId: anchor?.id ?? null,
      mpg: reason === "known" && gallons > 0 ? distance! * 1000 / gallons : null,
      intervalMiles: record.fullTank && anchor ? distance : null,
      gallonsMilli: record.fullTank && anchor ? gallons : null,
    };
    if (record.fullTank) { state.anchor = record; state.gallons = 0; state.broken = false; }
    else if (anchor) state.gallons = gallons;
    return result;
  }).reverse();
}

export function mpgExplanation(result: FuelMpg) {
  switch (result.reason) {
    case "known": return `${result.intervalMiles!.toLocaleString("en-US")} miles since the previous full tank, including partial fills.`;
    case "first-full": return "This full tank starts an MPG interval. MPG needs another full tank.";
    case "partial": return "Partial fill. Its gallons count toward MPG at the next full tank, once a full-tank starting point is recorded.";
    case "missed-fill": return "Missing fuel makes this MPG interval unknown. A recorded full tank starts a new interval.";
    case "no-distance": return "No miles between full tanks. MPG is unknown.";
    case "no-anchor": return "A previous full tank is needed to calculate MPG.";
  }
}

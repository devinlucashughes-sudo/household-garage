/**
 * VIN decoding through NHTSA's free vPIC service. The app only asks when a VIN is entered or
 * changed, keeps what came back on the car, and lets the household correct anything it filled in.
 */

const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";

/** 17 characters; VINs never use I, O or Q. */
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export const normalizeVin = (vin: string) => vin.toUpperCase().replace(/[\s-]/g, "");
export const isVin = (vin: string) => VIN_PATTERN.test(vin);

/** What the app keeps from a decode: the car's details and vPIC's own note on the VIN. */
export type VinDetails = {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  engine: string | null;
  body: string | null;
  drive: string | null;
  fuel: string | null;
  transmission: string | null;
  plant: string | null;
  /** "0" when vPIC decoded the VIN cleanly. */
  errorCode: string;
  errorText: string | null;
};

/** The fields a decode can fill in on the car. */
export type DecodedCarFields = Pick<VinDetails, "year" | "make" | "model" | "trim" | "engine">;

const SHOUTED_SHORT_NAMES = /^[A-Z]{1,3}$/; // BMW, GMC, KIA, RAM

/** "TOYOTA" becomes "Toyota"; short names like "BMW" stay as they are. */
export function tidyName(value: string) {
  return value
    .split(/(\s+|-)/)
    .map((word) =>
      SHOUTED_SHORT_NAMES.test(word) || word !== word.toUpperCase()
        ? word
        : word.charAt(0) + word.slice(1).toLowerCase(),
    )
    .join("");
}

function engineDescription(r: Record<string, string>) {
  const litres = Number.parseFloat(r.DisplacementL);
  const parts = [
    Number.isFinite(litres) && litres > 0 ? `${litres.toFixed(1)}L` : null,
    r.EngineCylinders ? `${r.EngineCylinders}-cyl` : null,
    r.ElectrificationLevel || null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** Reads one vPIC DecodeVinValues response. */
export function parseVpic(vin: string, json: unknown): VinDetails {
  const results = (json as { Results?: Record<string, string | null>[] })?.Results;
  if (!Array.isArray(results) || results.length === 0) throw new Error("No results from vPIC.");
  const raw = results[0];
  const r: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw))
    r[key] = typeof value === "string" ? value.trim() : "";
  const text = (value: string) => (value && value !== "Not Applicable" ? value : null);
  const year = Number.parseInt(r.ModelYear, 10);
  const plant = [r.PlantCity, r.PlantState, r.PlantCountry]
    .filter(Boolean)
    .map((p) => tidyName(p.replace(/\s*\(.*\)$/, "")))
    .join(", ");
  const transmission = [r.TransmissionSpeeds && `${r.TransmissionSpeeds}-speed`, r.TransmissionStyle]
    .filter(Boolean)
    .join(" ");
  return {
    vin,
    year: Number.isFinite(year) ? year : null,
    make: text(r.Make) && tidyName(r.Make),
    model: text(r.Model),
    trim: text([r.Trim, r.Series].filter(Boolean).join(" ")),
    engine: engineDescription(r),
    body: text(r.BodyClass),
    drive: text(r.DriveType),
    fuel: text(r.FuelTypePrimary),
    transmission: text(transmission),
    plant: plant || null,
    errorCode: r.ErrorCode || "0",
    errorText: r.ErrorCode && r.ErrorCode !== "0" ? text(r.ErrorText) : null,
  };
}

/** Asks vPIC about a VIN. Throws if vPIC can't be reached. */
export async function fetchVinDetails(vin: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${VPIC}/${encodeURIComponent(vin)}?format=json`, {
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`vPIC answered ${response.status}.`);
  return parseVpic(vin, await response.json());
}

/** True when vPIC had real doubts about the VIN, rather than just missing a detail. */
export function vinLooksWrong(details: VinDetails) {
  // 1: check digit wrong; 4, 5, 6, 7, 11, 400: mistyped, incomplete or unknown to NHTSA.
  const codes = details.errorCode.split(",").map((c) => c.trim());
  return codes.some((c) => ["1", "4", "5", "6", "7", "11", "400"].includes(c));
}

/**
 * Which decoded details to put on the car. A decoded value fills a field that is blank or still
 * shows what the last decode said; anything the person typed or corrected is kept.
 */
export function mergeDecoded<T extends Partial<DecodedCarFields>>(
  submitted: T,
  lastDecode: Partial<DecodedCarFields>,
  decoded: DecodedCarFields,
): T {
  const merged = { ...submitted };
  for (const key of ["year", "make", "model", "trim", "engine"] as const) {
    const value = decoded[key];
    if (value === null || value === undefined) continue;
    const typed = submitted[key];
    const untouched = typed === null || typed === undefined || typed === "" || typed === lastDecode[key];
    if (untouched) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

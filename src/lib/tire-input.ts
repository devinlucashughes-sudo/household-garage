import { z } from "zod";
import { dateInputValue } from "./format";

/**
 * Tires and tread depth: the shapes and form parsing shared by the server and the forms, so it holds
 * no server code. Depths are whole 32nds of an inch, the way a tread gauge and a shop report read.
 */

export const TIRE_SPOTS = [
  { key: "lf", label: "Front left", short: "LF" },
  { key: "rf", label: "Front right", short: "RF" },
  { key: "lr", label: "Rear left", short: "LR" },
  { key: "rr", label: "Rear right", short: "RR" },
  { key: "spare", label: "Spare", short: "Spare" },
] as const;
export type TirePosition = (typeof TIRE_SPOTS)[number]["key"];
export const TREAD_SPOTS = TIRE_SPOTS.filter((spot) => spot.key !== "spare");
export type TreadDepths = { lf: number | null; rf: number | null; lr: number | null; rr: number | null };
export type TreadKey = keyof TreadDepths;

export const positionLabel = (position: TirePosition | null) =>
  position === null ? "Position unknown" : TIRE_SPOTS.find((spot) => spot.key === position)!.label;

/** Below 4/32 wet grip falls off; 2/32 is the legal minimum in most states. */
export const REPLACE_AT_32NDS = 4;
export const LEGAL_MIN_32NDS = 2;
/** Many carmakers say to replace tires six years after they were made, whatever the tread. */
export const TIRE_AGE_LIMIT_YEARS = 6;

export type TireErrors = Record<string, string>;
export type TireFormState = { message?: string; errors?: TireErrors };

const day = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Choose a valid date.");
const optionalText = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`).nullable().transform((v) => v || null);
const miles = z.number().int().min(0).max(2_000_000).nullable();

/** "2324", "23/24" or "DOT 4B9X ABC 2324" all mean week 23 of 2024. */
export function parseDot(raw: string): string | null | undefined {
  const text = raw.trim();
  if (!text) return null;
  const digits = text.replace(/\s|\//g, "").match(/(\d{4})$/)?.[1];
  if (!digits) return undefined;
  const week = Number(digits.slice(0, 2));
  return week >= 1 && week <= 53 ? digits : undefined;
}

/** The Monday-ish date a DOT week code points at; close enough for a tire's age. */
export function dotMadeOn(dot: string, today: string) {
  const week = Number(dot.slice(0, 2));
  let year = 2000 + Number(dot.slice(2));
  if (`${year}` > today.slice(0, 4)) year -= 100;
  const made = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7, 12));
  return made.toISOString().slice(0, 10);
}

/** Whole and fractional years between two calendar days. */
export const yearsBetween = (from: string, to: string) =>
  (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / (365.25 * 86_400_000);

export const tireInputSchema = z.object({
  position: z.enum(["lf", "rf", "lr", "rr", "spare"]).nullable(),
  brand: optionalText(80),
  model: optionalText(80),
  size: optionalText(40),
  dot: z.string().regex(/^\d{4}$/).nullable(),
  installedDate: day,
  installedMiles: miles,
  serviceId: z.number().int().positive().nullable(),
  removedDate: day.nullable(),
  removedMiles: miles,
  notes: optionalText(2000),
}).superRefine((input, ctx) => {
  if (input.removedDate !== null && input.removedDate < input.installedDate)
    ctx.addIssue({ code: "custom", path: ["removedDate"], message: "It can't come off before it went on." });
  if (input.removedMiles !== null && input.installedMiles !== null && input.removedMiles < input.installedMiles)
    ctx.addIssue({ code: "custom", path: ["removedMiles"], message: "Use a mileage at or above the install mileage." });
});
export type TireInput = z.infer<typeof tireInputSchema>;

const text = (form: FormData, key: string) => typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";

function wholeMiles(form: FormData, key: string, errors: TireErrors) {
  const raw = text(form, key).replaceAll(",", "");
  if (!raw) return null;
  if (!/^\d+$/.test(raw) || Number(raw) > 2_000_000) { errors[key] = "Enter whole miles, such as 47,950, or leave it blank."; return null; }
  return Number(raw);
}

/**
 * Reads the tire form. Adding tires names one or more positions ("positions"); editing one tire names
 * a single "position", which may be blank when old records don't say.
 */
export function tireFromForm(form: FormData, now = Date.now()):
  | { ok: true; input: TireInput; positions: (TirePosition | null)[] }
  | { ok: false; errors: TireErrors } {
  const errors: TireErrors = {};
  const valid = (v: string): v is TirePosition => TIRE_SPOTS.some((spot) => spot.key === v);
  const adding = form.has("adding");
  const positions: (TirePosition | null)[] = adding
    ? [...new Set(form.getAll("positions").map(String).filter(valid))]
    : [valid(text(form, "position")) ? text(form, "position") as TirePosition : null];
  if (adding && positions.length === 0) errors.positions = "Tick where the new tires went on.";
  const dot = parseDot(text(form, "dot"));
  if (dot === undefined) errors.dot = "Type the last four digits of the DOT code, such as 2324 for week 23 of 2024.";
  const serviceRaw = text(form, "serviceId");
  const parsed = tireInputSchema.safeParse({
    position: positions[0] ?? null, brand: text(form, "brand"), model: text(form, "model"), size: text(form, "size"), dot: dot ?? null,
    installedDate: text(form, "installedDate"), installedMiles: wholeMiles(form, "installedMiles", errors),
    serviceId: /^\d+$/.test(serviceRaw) ? Number(serviceRaw) : null,
    removedDate: adding ? null : text(form, "removedDate") || null, removedMiles: adding ? null : wholeMiles(form, "removedMiles", errors),
    notes: text(form, "notes"),
  });
  if (!parsed.success) for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  const today = dateInputValue(now);
  if (text(form, "installedDate") > today) errors.installedDate = "Use the date they went on, up to today.";
  if (!adding && text(form, "removedDate") > today) errors.removedDate = "Use a date up to today.";
  if (!parsed.success || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, input: parsed.data, positions };
}

/**
 * Reads the four tread boxes ("tread.lf" and so on). All blank means no reading; "9" and "9/32" both
 * mean 9/32 of an inch.
 */
export function treadFromForm(form: FormData):
  | { ok: true; tread: TreadDepths | null }
  | { ok: false; errors: TireErrors } {
  const errors: TireErrors = {};
  const tread: TreadDepths = { lf: null, rf: null, lr: null, rr: null };
  for (const spot of TREAD_SPOTS) {
    const raw = text(form, `tread.${spot.key}`).replace(/\s*\/\s*32$/, "");
    if (!raw) continue;
    if (!/^\d{1,2}$/.test(raw) || Number(raw) > 20) errors[`tread.${spot.key}`] = `${spot.label}: type the 32nds, such as 9.`;
    else tread[spot.key] = Number(raw);
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, tread: Object.values(tread).some((v) => v !== null) ? tread : null };
}

/** Values for the four boxes, from a stored reading. */
export const treadValues = (tread: TreadDepths | null): Record<TreadKey, string> => ({
  lf: tread?.lf == null ? "" : String(tread.lf), rf: tread?.rf == null ? "" : String(tread.rf),
  lr: tread?.lr == null ? "" : String(tread.lr), rr: tread?.rr == null ? "" : String(tread.rr),
});

export const lowestTread = (tread: TreadDepths) => {
  const known = Object.values(tread).filter((v): v is number => v !== null);
  return known.length ? Math.min(...known) : null;
};

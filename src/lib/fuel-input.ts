import { z } from "zod";
import { dateInputValue } from "./format";

export type FuelErrors = Record<string, string>;
export type FuelFormState = { message?: string; errors?: FuelErrors };

/** Parse decimal digits directly, without floating point rounding. */
function decimalInput(places: number, maximum: number, label: string, currency = false) {
  return z.string().trim().transform((raw, ctx) => {
    const value = currency ? raw.replace(/^\$\s*/, "") : raw;
    const pattern = new RegExp(`^(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,${places}})?$`);
    if (!pattern.test(value)) {
      ctx.addIssue({ code: "custom", message: `Enter ${label} with up to ${places} decimal places.` });
      return z.NEVER;
    }
    const [whole, fraction = ""] = value.replaceAll(",", "").split(".");
    const amount = Number(whole) * 10 ** places + Number(fraction.padEnd(places, "0"));
    if (!Number.isSafeInteger(amount) || amount > maximum) {
      ctx.addIssue({ code: "custom", message: `That ${label} is too large. Check the pump.` });
      return z.NEVER;
    }
    return amount;
  });
}

export const fuelMoneyInput = decimalInput(2, 1_000_000_000, "the total paid in dollars", true);
export const gallonsInput = decimalInput(3, 1_000_000, "US gallons").pipe(z.number().positive("Enter more than zero gallons."));
export const fuelMilesInput = z.string().trim().regex(/^(?:\d{1,3}(?:,\d{3})+|\d+)$/, "Enter whole odometer miles, such as 47,950.")
  .transform((v) => Number(v.replaceAll(",", ""))).pipe(z.number().int().min(0).max(2_000_000, "Check the odometer. Use no more than 2,000,000 miles."));

export const fuelInputSchema = z.object({
  date: z.string().refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Choose a valid fill-up date."),
  miles: z.number().int().min(0).max(2_000_000),
  gallonsMilli: z.number().int().positive().max(1_000_000),
  totalCents: z.number().int().min(0).max(1_000_000_000),
  fullTank: z.boolean(),
  missedFillups: z.boolean(),
  notes: z.string().trim().max(5000, "Keep notes under 5,000 characters.").transform((v) => v || null).nullable(),
});
export type FuelInput = z.infer<typeof fuelInputSchema>;

export function fuelFromForm(form: FormData, now = Date.now()): { ok: true; input: FuelInput } | { ok: false; errors: FuelErrors } {
  const text = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)) : "";
  const errors: FuelErrors = {};
  const numeric = { miles: fuelMilesInput.safeParse(text("miles")), gallonsMilli: gallonsInput.safeParse(text("gallonsMilli")), totalCents: fuelMoneyInput.safeParse(text("totalCents")) };
  for (const [key, result] of Object.entries(numeric)) if (!result.success) errors[key] = result.error.issues[0].message;
  for (const key of ["fullTank", "missedFillups"]) {
    if (form.get(key) !== null && form.get(key) !== "on") errors[key] = "Choose this option again.";
  }
  const parsed = fuelInputSchema.safeParse({
    date: text("date"), miles: numeric.miles.success ? numeric.miles.data : undefined,
    gallonsMilli: numeric.gallonsMilli.success ? numeric.gallonsMilli.data : undefined,
    totalCents: numeric.totalCents.success ? numeric.totalCents.data : undefined,
    fullTank: text("fullTank") === "on", missedFillups: text("missedFillups") === "on", notes: text("notes"),
  });
  if (!parsed.success) for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  if (text("date") > dateInputValue(now)) errors.date = "Use the fill-up date, up to today.";
  if (!parsed.success || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}

export const gallonsValue = (milli: number) => `${Math.floor(milli / 1000)}.${String(milli % 1000).padStart(3, "0")}`;
export const fuelMoneyValue = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

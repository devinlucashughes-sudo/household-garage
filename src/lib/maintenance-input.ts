import { z } from "zod";
import { dateInputValue } from "./format";

export type MaintenanceErrors = Record<string, string>;
export type MaintenanceFormState = { message?: string; errors?: MaintenanceErrors; stale?: boolean };

const date = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Choose a valid calendar date.");

/** Domain values for both hand entry and reviewed imports. Empty mileage is never zero. */
export const maintenanceInputSchema = z.object({
  title: z.string().trim().min(1, "Name the maintenance, such as an oil change.").max(160, "Keep the name under 160 characters."),
  intervalMiles: z.number().int().min(1, "Use a positive number of miles.").max(2_000_000).nullable(),
  intervalMonths: z.number().int().min(1, "Use a positive number of months.").max(1200).nullable(),
  baselineDate: date.nullable(),
  baselineMiles: z.number().int().min(0).max(2_000_000).nullable(),
  lastServiceId: z.number().int().positive().nullable(),
  enabled: z.boolean(),
  optional: z.boolean().optional(),
  asksTread: z.boolean().optional(),
  notes: z.string().trim().max(5000, "Keep notes under 5,000 characters.").nullable().transform((value) => value || null),
}).superRefine((input, ctx) => {
  if (input.intervalMiles === null && input.intervalMonths === null)
    ctx.addIssue({ code: "custom", path: ["intervalMiles"], message: "Enter a mile interval, a month interval, or both." });
}).transform((input) => input.lastServiceId === null ? input : { ...input, baselineDate: null, baselineMiles: null });

export type MaintenanceInput = z.infer<typeof maintenanceInputSchema>;

export function maintenanceFromForm(form: FormData, now = Date.now()):
  | { ok: true; input: MaintenanceInput }
  | { ok: false; errors: MaintenanceErrors } {
  const text = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";
  const errors: MaintenanceErrors = {};
  const number = (key: string) => {
    const raw = text(key);
    if (!raw) return null;
    if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(raw)) {
      errors[key] = "Enter a whole number, or leave it blank.";
      return null;
    }
    return Number(raw.replaceAll(",", ""));
  };
  const lastServiceId = number("lastServiceId");
  const parsed = maintenanceInputSchema.safeParse({
    title: text("title"), intervalMiles: number("intervalMiles"), intervalMonths: number("intervalMonths"),
    baselineDate: lastServiceId === null ? text("baselineDate") || null : null,
    baselineMiles: lastServiceId === null ? number("baselineMiles") : null,
    lastServiceId, enabled: text("enabled") === "on", optional: text("optional") === "on", asksTread: text("asksTread") === "on", notes: text("notes") || null,
  });
  if (!parsed.success) for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  if (lastServiceId === null && text("baselineDate") > dateInputValue(now)) errors.baselineDate = "Use a baseline date up to today.";
  if (!parsed.success || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}

export type MaintenanceFormInitial = {
  title: string; intervalMiles: string; intervalMonths: string; baselineDate: string; baselineMiles: string;
  lastServiceId: string; enabled: boolean; optional: boolean; asksTread: boolean; notes: string; requestKey: string; revision?: number;
};

export const maintenanceStateLabel = (state: "overdue" | "due-soon" | "upcoming" | "needs-baseline" | null) =>
  state === null ? "Disabled" : ({ overdue: "Due now", "due-soon": "Due soon", upcoming: "Upcoming", "needs-baseline": "Needs baseline" }[state]);

export const maintenanceDay = (day: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

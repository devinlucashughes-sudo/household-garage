import { z } from "zod";
import { SERVICE_CATEGORIES } from "./cost-categories";
import { dateInputValue } from "./format";

export const MAX_LINE_ITEMS = 30;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const MAX_RECEIPTS = 10;
export const RECEIPT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";

export type LineItem = { description: string; costCents: number | null };
export type ServiceErrors = Record<string, string>;
export type ServiceFormState = { message?: string; errors?: ServiceErrors };

const optionalText = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`).transform((v) => v || null);

export const moneyInput = z.string().trim().transform((v, ctx) => {
  if (!v) return null;
  const amount = v.replace(/^\$\s*/, "");
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(amount)) {
    ctx.addIssue({ code: "custom", message: "Enter a dollar amount such as 125.50, or leave it blank." });
    return z.NEVER;
  }
  const cents = Math.round(Number(amount.replaceAll(",", "")) * 100);
  if (!Number.isSafeInteger(cents) || cents > 1_000_000_000) {
    ctx.addIssue({ code: "custom", message: "That amount is too large. Check the receipt." });
    return z.NEVER;
  }
  return cents;
});

const optionalMiles = z.string().trim().transform((v, ctx) => {
  if (!v) return null;
  const digits = v.replaceAll(",", "");
  if (!/^\d+$/.test(digits) || Number(digits) > 2_000_000) {
    ctx.addIssue({ code: "custom", message: "Enter whole miles, such as 47,950, or leave it blank." });
    return z.NEVER;
  }
  return Number(digits);
});

export const serviceInputSchema = z.object({
  kind: z.enum(["service", "quote"], { error: "Choose completed service or quote." }),
  title: z.string().trim().min(1, "Describe the work, such as an oil change.").max(160, "Keep the description under 160 characters."),
  /** Left out, it is guessed from the title when saved. */
  category: z.enum(SERVICE_CATEGORIES, { error: "Choose what kind of cost this is." }).optional(),
  date: z.string().refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Choose a valid date."),
  shop: optionalText(120),
  miles: optionalMiles,
  totalCents: moneyInput,
  notes: optionalText(5000),
  lineItems: z.array(z.object({ description: z.string().min(1).max(200), costCents: z.number().int().min(0).max(1_000_000_000).nullable() })).max(MAX_LINE_ITEMS),
});

export type ServiceInput = z.infer<typeof serviceInputSchema>;

export function serviceFromForm(form: FormData, now = Date.now()):
  | { ok: true; input: ServiceInput }
  | { ok: false; errors: ServiceErrors } {
  const text = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)) : "";
  const descriptions = form.getAll("itemDescription");
  const costs = form.getAll("itemCost");
  const errors: ServiceErrors = {};
  const lineItems: LineItem[] = [];
  if (descriptions.length > MAX_LINE_ITEMS || descriptions.length !== costs.length)
    errors.itemDescription0 = `Use no more than ${MAX_LINE_ITEMS} line items, with a description for each amount.`;
  for (let i = 0; i < Math.min(descriptions.length, MAX_LINE_ITEMS); i++) {
    const description = typeof descriptions[i] === "string" ? String(descriptions[i]).trim() : "";
    const rawCost = typeof costs[i] === "string" ? String(costs[i]).trim() : "";
    if (!description && !rawCost) continue;
    if (!description || description.length > 200) errors[`itemDescription${i}`] = "Give this line item a description under 200 characters.";
    const cost = moneyInput.safeParse(rawCost);
    if (!cost.success) errors[`itemCost${i}`] = cost.error.issues[0].message;
    else lineItems.push({ description, costCents: cost.data });
  }
  const parsed = serviceInputSchema.safeParse({
    kind: text("kind"), title: text("title"), category: text("category") || undefined, date: text("date"), shop: text("shop"),
    miles: text("miles"), totalCents: text("totalCents"), notes: text("notes"), lineItems,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  }
  if (text("date") > dateInputValue(now)) errors.date = "Use the date of completed work or the date the quote was issued, up to today.";
  if (!parsed.success || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}

export const formatMoney = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export const moneyValue = (cents: number | null) => cents === null ? "" : (cents / 100).toFixed(2);
export const serviceDay = (day: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

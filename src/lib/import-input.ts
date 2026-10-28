import { z } from "zod";
import { SERVICE_CATEGORIES } from "./cost-categories";
import { serviceInputSchema } from "./service-input";
import { maintenanceInputSchema } from "./maintenance-input";
import { dateInputValue } from "./format";

export const MAX_IMPORT_BYTES = 128 * 1024;
export type ImportState = { message?: string; secret?: string; success?: boolean; errors?: Record<string, string>; signInRequired?: boolean };
export class ImportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const cents = z.number().int().min(0).max(1_000_000_000).nullable().default(null);
const serviceWire = z.object({
  kind: z.enum(["service", "quote"]), title: z.string(), category: z.enum(SERVICE_CATEGORIES).optional(), date: z.string(),
  shop: z.string().nullable().default(null), miles: z.number().int().min(0).max(2_000_000).nullable().default(null),
  totalCents: cents, notes: z.string().nullable().default(null),
  lineItems: z.array(z.object({ description: z.string(), costCents: cents })).default([]),
}).strict();
const maintenanceWire = z.object({
  title: z.string(), intervalMiles: z.number().nullable().default(null), intervalMonths: z.number().nullable().default(null),
  baselineDate: z.string().nullable().default(null), baselineMiles: z.number().nullable().default(null),
  lastServiceId: z.number().nullable().default(null), enabled: z.boolean().default(true), optional: z.boolean().default(false), asksTread: z.boolean().default(false),
  notes: z.string().nullable().default(null),
}).strict();
const envelope = z.object({
  type: z.enum(["service", "maintenance"]), carId: z.number().int().positive(), requestId: z.uuid(),
  sourceLabel: z.string().trim().max(160).optional(), data: z.unknown(),
}).strict();

export function normalizeImportData(type: "service" | "maintenance", data: unknown, now = Date.now()) {
  if (type === "maintenance") {
    const input = maintenanceInputSchema.parse(maintenanceWire.parse(data));
    if (input.baselineDate !== null && input.baselineDate > dateInputValue(now)) throw new ImportError("Use a baseline date up to today.");
    return input;
  }
  const value = serviceWire.parse(data);
  // The established service schema takes form strings and returns domain values.
  const normalized = serviceInputSchema.parse({ ...value, shop: value.shop ?? "", notes: value.notes ?? "",
    miles: value.miles === null ? "" : String(value.miles),
    totalCents: value.totalCents === null ? "" : (value.totalCents / 100).toFixed(2),
  });
  if (normalized.date > dateInputValue(now)) throw new ImportError("Use a service or quote date up to today.");
  return normalized;
}

export function parseImport(value: unknown, now = Date.now()) {
  try {
    const wire = envelope.parse(value);
    return { ...wire, sourceLabel: wire.sourceLabel || null, data: normalizeImportData(wire.type, wire.data, now) };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      throw new ImportError(`${issue.path.join(".") || "JSON"}: ${issue.message}`);
    }
    throw error;
  }
}

export function parseImportText(text: string, now = Date.now()) {
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) throw new ImportError("JSON must be no larger than 128 KB.", 413);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ImportError("Enter valid JSON, then try again."); }
  return parseImport(value, now);
}

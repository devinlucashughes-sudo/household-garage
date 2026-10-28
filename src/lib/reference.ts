import { z } from "zod";

/**
 * The quick-reference card: what you need at the parts counter or the oil change place.
 * Shared by the server and the edit form, so it holds no server code.
 */

export type ReferenceField = {
  key: string;
  label: string;
  /** An example shown in the empty box. */
  hint: string;
  /** Number fields get the number keypad and a unit after the value. */
  unit?: string;
};

export type ReferenceGroup = { title: string; fields: ReferenceField[] };

export const REFERENCE_GROUPS: ReferenceGroup[] = [
  {
    title: "Oil and filters",
    fields: [
      { key: "oil", label: "Oil", hint: "0W-20 full synthetic" },
      { key: "oilCapacity", label: "Oil amount", hint: "4.4 qt with filter" },
      { key: "oilFilter", label: "Oil filter", hint: "Mobil 1 M1-110A" },
      { key: "airFilter", label: "Engine air filter", hint: "FRAM CA10171" },
      { key: "cabinFilter", label: "Cabin air filter", hint: "FRAM CF10134" },
    ],
  },
  {
    title: "Tires",
    fields: [
      { key: "tireSize", label: "Tire size", hint: "225/65R17 102H" },
      { key: "tirePressureFront", label: "Front pressure", hint: "35", unit: "psi" },
      { key: "tirePressureRear", label: "Rear pressure", hint: "35", unit: "psi" },
    ],
  },
  {
    title: "Wipers",
    fields: [
      { key: "wiperDriver", label: "Driver", hint: "26", unit: "in" },
      { key: "wiperPassenger", label: "Passenger", hint: "17", unit: "in" },
      { key: "wiperRear", label: "Rear", hint: "12", unit: "in" },
    ],
  },
  {
    title: "Bulbs",
    fields: [
      { key: "bulbLow", label: "Low beam", hint: "H11" },
      { key: "bulbHigh", label: "High beam", hint: "9005" },
      { key: "bulbFog", label: "Fog", hint: "H16" },
    ],
  },
  {
    title: "Battery",
    fields: [{ key: "battery", label: "Battery", hint: "Group 35, 640 CCA" }],
  },
];

export const REFERENCE_FIELDS = REFERENCE_GROUPS.flatMap((g) => g.fields);
const fieldByKey = new Map(REFERENCE_FIELDS.map((f) => [f.key, f]));

/** Extra lines the household adds, such as "Lug nut torque: 76 lb-ft". */
export const MAX_EXTRA_LINES = 20;

const line = z.string().trim().max(200, "Keep each line under 200 characters.");

export const referenceSchema = z.object({
  values: z.record(z.string(), line).default({}),
  extra: z
    .array(z.object({ label: line, value: line }))
    .max(MAX_EXTRA_LINES)
    .default([]),
});

export type QuickReference = z.infer<typeof referenceSchema>;

export const emptyReference = (): QuickReference => ({ values: {}, extra: [] });

/** Reads the stored card, tolerating anything old or odd rather than failing the page. */
export function parseReference(stored: string | null | undefined): QuickReference {
  if (!stored) return emptyReference();
  try {
    const parsed = referenceSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : emptyReference();
  } catch {
    return emptyReference();
  }
}

export type ReferenceInput =
  | { ok: true; reference: QuickReference }
  | { ok: false; message: string };

/**
 * Reads the edit form: one box per known field ("ref.oil") and pairs of boxes for extra lines
 * ("extraLabel" and "extraValue", repeated). Blank boxes are dropped.
 */
export function referenceFromForm(form: FormData): ReferenceInput {
  const values: Record<string, string> = {};
  for (const field of REFERENCE_FIELDS) {
    const value = String(form.get(`ref.${field.key}`) ?? "").trim();
    if (!value) continue;
    if (field.unit && !/^\d{1,3}(\.\d)?$/.test(value))
      return { ok: false, message: `${field.label}: type just the number of ${field.unit}.` };
    values[field.key] = value;
  }
  const labels = form.getAll("extraLabel").map((v) => String(v).trim());
  const extraValues = form.getAll("extraValue").map((v) => String(v).trim());
  const extra = labels
    .map((label, i) => ({ label, value: extraValues[i] ?? "" }))
    .filter((e) => e.label || e.value);
  if (extra.some((e) => !e.label || !e.value))
    return { ok: false, message: "Each extra line needs both a name and a value." };
  const parsed = referenceSchema.safeParse({ values, extra });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  return { ok: true, reference: parsed.data };
}

/** "35 psi", or the text as typed. */
export function displayValue(key: string, value: string) {
  const unit = fieldByKey.get(key)?.unit;
  if (!unit) return value;
  return unit === "in" ? `${value}″` : `${value} ${unit}`;
}

/** The card's filled-in lines, grouped for display. Front and rear pressure merge when equal. */
export function referenceLines(reference: QuickReference) {
  const groups = REFERENCE_GROUPS.map((group) => {
    const v = reference.values;
    const lines: { label: string; value: string }[] = [];
    for (const field of group.fields) {
      const value = v[field.key];
      if (!value) continue;
      if (field.key === "tirePressureRear" && v.tirePressureFront === value) continue;
      const label =
        field.key === "tirePressureFront" && v.tirePressureRear === value ? "Pressure" : field.label;
      lines.push({ label, value: displayValue(field.key, value) });
    }
    return { title: group.title, lines };
  }).filter((g) => g.lines.length > 0);
  if (reference.extra.length > 0) groups.push({ title: "Other", lines: reference.extra });
  return groups;
}

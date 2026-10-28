/** What a service record's money went on. Fuel is the sixth kind of cost and comes from fill-ups, not service records. */
export const SERVICE_CATEGORIES = ["oil", "tires", "maintenance", "repairs", "body"] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

/** Fixed order everywhere, so each kind keeps its place and color in every bar and list. */
export const COST_CATEGORIES = ["fuel", ...SERVICE_CATEGORIES] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const categoryInfo: Record<CostCategory, { label: string; one: string; many: string; hint: string }> = {
  fuel: { label: "Fuel", one: "fill-up", many: "fill-ups", hint: "Fill-ups and budget fuel payments" },
  oil: { label: "Oil changes", one: "oil change", many: "oil changes", hint: "Oil and filter, with anything done at the same time" },
  tires: { label: "Tires", one: "record", many: "records", hint: "New tires, rotations, tread checks and alignments" },
  maintenance: { label: "Maintenance", one: "record", many: "records", hint: "Wear parts and upkeep: brakes, battery, filters, wipers, bulbs, inspections" },
  repairs: { label: "Repairs", one: "repair", many: "repairs", hint: "Something broke or failed and had to be fixed" },
  body: { label: "Body work", one: "record", many: "records", hint: "Dents, paint, trim and panels" },
};

export const isCostCategory = (value: unknown): value is CostCategory => COST_CATEGORIES.includes(value as CostCategory);

/**
 * Words in a title that point to a kind of cost, checked in this order. Migration 0009 sorted the
 * records saved before categories existed with the same words, so keep the two in step.
 */
const GUESSES: [ServiceCategory, string[]][] = [
  ["oil", ["oil change", "oil and filter"]],
  ["body", ["body", "dent", "paint", "bumper", "fender", "scratch", "collision"]],
  ["tires", ["tire", "tread", "alignment"]],
  ["repairs", ["repair", "diagnos", "check-engine", "check engine", "leak", "sensor", "module", "booster", "master cylinder", "water pump", "radiator", "drain plug", "warranty", "transmission"]],
];

/** A starting guess from the description; people can always pick another kind. */
export function guessCategory(title: string): ServiceCategory {
  const text = title.toLowerCase();
  return GUESSES.find(([, words]) => words.some((word) => text.includes(word)))?.[0] ?? "maintenance";
}

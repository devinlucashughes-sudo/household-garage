import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase, QueryDatabase } from "./db";
import { budgetFuelPayments, cars, fuelRecords } from "./schema";

export type BudgetFuelPayment = typeof budgetFuelPayments.$inferSelect;
const date = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid date.");

export const budgetFuelInputSchema = z.object({
  carId: z.number().int().positive(),
  date,
  totalCents: z.number().int().positive().max(1_000_000_000),
  payee: z.string().max(200),
  memo: z.string().max(1000),
  sourceFile: z.string().min(1).max(255),
  sourceRecord: z.number().int().min(2),
  sourceKey: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type BudgetFuelInput = z.infer<typeof budgetFuelInputSchema>;
export type BudgetFuelDatabase = Pick<AppDatabase, "select" | "insert" | "transaction">;

export const budgetFuelFor = (db: QueryDatabase, carId: number): BudgetFuelPayment[] => db.select()
  .from(budgetFuelPayments).where(eq(budgetFuelPayments.carId, carId))
  .orderBy(desc(budgetFuelPayments.date), desc(budgetFuelPayments.id)).all();

export const getBudgetFuel = (db: QueryDatabase, carId: number, id: number): BudgetFuelPayment | null => db.select()
  .from(budgetFuelPayments).where(and(eq(budgetFuelPayments.carId, carId), eq(budgetFuelPayments.id, id))).get() ?? null;

/** A retry is safe; conflicting source records or a possible existing fill-up abort the whole batch. */
export function importBudgetFuel(db: BudgetFuelDatabase, rawRows: unknown, options: { apply: boolean; now?: number }) {
  const rows = z.array(budgetFuelInputSchema).max(20_000).parse(rawRows);
  if (new Set(rows.map((row) => row.sourceKey)).size !== rows.length) throw new Error("The import contains repeated source keys.");
  const now = options.now ?? Date.now();
  return db.transaction((tx) => {
    let added = 0;
    let alreadyImported = 0;
    for (const row of rows) {
      if (!tx.select({ id: cars.id }).from(cars).where(eq(cars.id, row.carId)).get()) throw new Error("An import car no longer exists.");
      const existing = tx.select().from(budgetFuelPayments).where(eq(budgetFuelPayments.sourceKey, row.sourceKey)).get();
      if (existing) {
        if (!(Object.keys(row) as (keyof BudgetFuelInput)[]).every((key) => existing[key] === row[key])) {
          throw new Error("An imported source record has different values. Review it before retrying.");
        }
        alreadyImported++;
        continue;
      }
      const possibleDuplicate = tx.select({ id: fuelRecords.id }).from(fuelRecords).where(and(
        eq(fuelRecords.carId, row.carId), eq(fuelRecords.date, row.date), eq(fuelRecords.totalCents, row.totalCents),
      )).get();
      if (possibleDuplicate) throw new Error("A recorded fill-up has the same car, date and amount as a budget payment. Review it before importing.");
      if (options.apply) tx.insert(budgetFuelPayments).values({ ...row, importedAt: now }).run();
      added++;
    }
    return { added, alreadyImported, total: rows.length };
  });
}

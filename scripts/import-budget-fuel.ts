import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { budgetFuelInputSchema, importBudgetFuel } from "../src/lib/budget-fuel";
import { getConnection } from "../src/lib/db";
import { cars } from "../src/lib/schema";

const carControl = z.object({
  id: z.number().int().positive(), make: z.string().min(1), model: z.string().min(1),
  count: z.number().int().nonnegative(), totalCents: z.number().int().nonnegative(),
}).strict();
const batchSchema = z.object({ version: z.literal(1), cars: z.array(carControl).min(1), rows: z.array(budgetFuelInputSchema).max(20_000) }).strict();

try {
  const mode = process.argv[2];
  if (mode !== "--check" && mode !== "--apply") throw new Error("Choose --check or --apply and provide the JSON batch on stdin.");
  const batch = batchSchema.parse(JSON.parse(readFileSync(0, "utf8")));
  if (new Set(batch.cars.map((car) => car.id)).size !== batch.cars.length) throw new Error("The car controls contain duplicate IDs.");
  const ids = new Set(batch.cars.map((car) => car.id));
  if (batch.rows.some((row) => !ids.has(row.carId))) throw new Error("A payment does not have a car control.");
  const { db, sqlite } = getConnection();
  try {
    for (const control of batch.cars) {
      const car = db.select().from(cars).where(eq(cars.id, control.id)).get();
      if (!car || car.make?.toLowerCase() !== control.make.toLowerCase() || car.model?.toLowerCase() !== control.model.toLowerCase()) {
        throw new Error(`Car ${control.id} does not match the import's make and model.`);
      }
      const rows = batch.rows.filter((row) => row.carId === control.id);
      if (rows.length !== control.count || rows.reduce((sum, row) => sum + row.totalCents, 0) !== control.totalCents) {
        throw new Error(`Car ${control.id} does not match the import's count and cent totals.`);
      }
    }
    const result = importBudgetFuel(db, batch.rows, { apply: mode === "--apply" });
    console.log(JSON.stringify({ mode, ...result, cars: batch.cars }));
  } finally {
    sqlite.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "The import failed.");
  process.exitCode = 1;
}

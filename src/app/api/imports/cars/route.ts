import { getDatabase } from "@/lib/db";
import { cars } from "@/lib/schema";
import { authenticateImportToken } from "@/lib/imports";
import { bearer, importFailure, importResponse } from "@/lib/import-http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const db = getDatabase(); authenticateImportToken(db, bearer(request));
    return importResponse({ cars: db.select({ id: cars.id, name: cars.nickname, vin: cars.vin }).from(cars).all() });
  } catch (error) { return importFailure(error); }
}

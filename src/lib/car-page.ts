import "server-only";
import { notFound } from "next/navigation";
import { getCar } from "./cars";
import { getDatabase } from "./db";
import { requireUser } from "./session";

/** The sign-in check plus the car named in the address, or a 404. */
export async function carFromParams(params: Promise<{ id: string }>) {
  const user = await requireUser();
  const { id } = await params;
  const car = /^\d+$/.test(id) ? getCar(getDatabase(), Number(id)) : null;
  if (!car) notFound();
  return { user, car };
}

/** The time a page is drawn at. Server pages render once per request, so one reading is enough. */
export const pageTime = () => Date.now();

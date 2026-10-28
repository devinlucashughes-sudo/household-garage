import "server-only";
import { notFound } from "next/navigation";
import { carFromParams } from "./car-page";
import { getDatabase } from "./db";
import { getFuel, type FuelRecord } from "./fuel";
import { fuelMoneyValue, gallonsValue } from "./fuel-input";
import { mileageFor, readingsFor, type Car } from "./cars";
import { formatMiles, formatShortDay } from "./format";

export async function fuelFromParams(params: Promise<{ id: string; fuelId: string }>) {
  const { car, user } = await carFromParams(params);
  const { fuelId } = await params;
  const record = /^\d+$/.test(fuelId) ? getFuel(getDatabase(), car.id, Number(fuelId)) : null;
  if (!record) notFound();
  return { car, user, record };
}

export function fuelFormInitial(today: string, requestKey: string, record?: FuelRecord) {
  return { date: record?.date ?? today, miles: record ? String(record.miles) : "", gallonsMilli: record ? gallonsValue(record.gallonsMilli) : "",
    totalCents: record ? fuelMoneyValue(record.totalCents) : "", fullTank: record?.fullTank ?? true,
    missedFillups: record?.missedFillups ?? false, notes: record?.notes ?? "", requestKey, revision: record?.revision };
}

/** The cars a fill-up can be for, each with its last odometer reading as the hint under Odometer. */
export function fuelCars(cars: Pick<Car, "id" | "nickname">[], now: number) {
  const db = getDatabase();
  return cars.map(({ id, nickname }) => {
    const mileage = mileageFor(readingsFor(db, id), now);
    const hint = mileage.kind === "none" ? "No reading yet" : `Last reading ${formatMiles(mileage.latest.miles)} on ${formatShortDay(mileage.latest.at, now)}`;
    return { id, nickname, hint };
  });
}

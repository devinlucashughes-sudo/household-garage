import { randomUUID } from "node:crypto";
import { FuelForm } from "@/components/fuel-form";
import { carFromParams, pageTime } from "@/lib/car-page";
import { dateInputValue } from "@/lib/format";
import { fuelCars, fuelFormInitial } from "@/lib/fuel-page";

export default async function NewFuelPage({ params }: { params: Promise<{ id: string }> }) {
  const { car } = await carFromParams(params);
  const now = pageTime();
  const today = dateInputValue(now);
  return <main className="page">
    <FuelForm cars={fuelCars([car], now)} carId={car.id} today={today} title={`Fill-up for ${car.nickname}`} initial={fuelFormInitial(today, randomUUID())} />
  </main>;
}

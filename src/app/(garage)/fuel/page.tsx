import { randomUUID } from "node:crypto";
import Link from "next/link";
import { FuelForm } from "@/components/fuel-form";
import { listCars } from "@/lib/cars";
import { pageTime } from "@/lib/car-page";
import { getDatabase } from "@/lib/db";
import { dateInputValue } from "@/lib/format";
import { fuelCars, fuelFormInitial } from "@/lib/fuel-page";
import { requireUser } from "@/lib/session";
import "@/app/fuel.css";

export default async function QuickFuelPage() {
  await requireUser();
  const now = pageTime();
  const cars = fuelCars(listCars(getDatabase()), now);
  const today = dateInputValue(now);
  return <main className="page">
    {cars.length ? <FuelForm cars={cars} today={today} title="Fill-up" initial={fuelFormInitial(today, randomUUID())} /> : <>
      <h1 className="page-title">Fill-up</h1>
      <section className="panel"><p>Add a car before recording fuel.</p><Link className="button" href="/cars/new">Add car</Link></section>
    </>}
  </main>;
}

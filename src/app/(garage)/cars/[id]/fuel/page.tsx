import { CarHeader } from "@/components/car-header";
import Link from "next/link";
import { FuelRows } from "@/components/fuel-rows";
import { carFromParams } from "@/lib/car-page";
import { getDatabase } from "@/lib/db";
import { fuelFor } from "@/lib/fuel";
import { budgetFuelFor } from "@/lib/budget-fuel";
import "@/app/fuel.css";

export default async function FuelHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { car } = await carFromParams(params);
  const records = fuelFor(getDatabase(), car.id);
  const payments = budgetFuelFor(getDatabase(), car.id);
  return <main className="page"><CarHeader car={car} section="fuel" />
    <Link className="button button--wide" href={`/cars/${car.id}/fuel/new`}>Add fill-up</Link>
    <section className="panel" aria-labelledby="fuel-history"><h2 id="fuel-history">Fuel history</h2>
      {records.length || payments.length ? <FuelRows carId={car.id} records={records} payments={payments} /> : <p className="lede">No fuel recorded. Add a full tank to start tracking MPG, or record a partial fill.</p>}
    </section>
    <p className="lede">MPG uses miles and all gallons between full tanks. A missing fill-up or a budget payment without gallons breaks the interval. Same-day fill-ups are ordered by odometer.</p>
  </main>;
}

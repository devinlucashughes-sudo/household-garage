import Link from "next/link";
import { DeleteFuel } from "@/components/fuel-controls";
import { formatMiles } from "@/lib/format";
import { gallonsValue } from "@/lib/fuel-input";
import { fuelFromParams } from "@/lib/fuel-page";
import { formatMoney, serviceDay } from "@/lib/service-input";

export default async function DeleteFuelPage({ params }: { params: Promise<{ id: string; fuelId: string }> }) {
  const { car, record } = await fuelFromParams(params);
  return <main className="page"><Link className="back" href={`/cars/${car.id}/fuel/${record.id}`}>‹ Fill-up</Link>
    <h1 className="page-title">Delete this fill-up?</h1>
    <p>This removes the fill-up and its mileage reading. MPG will be recalculated. This cannot be undone.</p>
    <section className="panel" aria-labelledby="delete-fuel"><h2 id="delete-fuel">{car.nickname}</h2>
      <dl className="specs"><div><dt>Date</dt><dd>{serviceDay(record.date)}</dd></div>
        <div><dt>Odometer</dt><dd>{formatMiles(record.miles)} miles</dd></div>
        <div><dt>Gallons</dt><dd>{gallonsValue(record.gallonsMilli)} US gal</dd></div>
        <div><dt>Total paid</dt><dd>{formatMoney(record.totalCents)}</dd></div>
      </dl>
    </section>
    <DeleteFuel carId={car.id} fuelId={record.id} revision={record.revision} />
    <Link className="button button--quiet" href={`/cars/${car.id}/fuel/${record.id}`}>Keep fill-up</Link>
  </main>;
}

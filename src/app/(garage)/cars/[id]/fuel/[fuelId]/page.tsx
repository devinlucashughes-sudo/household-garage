import Link from "next/link";
import { getDatabase } from "@/lib/db";
import { fuelFor } from "@/lib/fuel";
import { budgetFuelFor } from "@/lib/budget-fuel";
import { gallonsValue } from "@/lib/fuel-input";
import { calculateMpg, mpgExplanation } from "@/lib/fuel-mpg";
import { fuelFromParams } from "@/lib/fuel-page";
import { formatMiles } from "@/lib/format";
import { formatMoney, serviceDay } from "@/lib/service-input";
import "@/app/fuel.css";

export default async function FuelDetailPage({ params, searchParams }: { params: Promise<{ id: string; fuelId: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { car, record } = await fuelFromParams(params);
  const result = calculateMpg(fuelFor(getDatabase(), car.id), budgetFuelFor(getDatabase(), car.id)).find((result) => result.id === record.id)!;
  return <main className="page"><Link className="back" href={`/cars/${car.id}/fuel`}>‹ {car.nickname}&apos;s fuel</Link>
    <div className="title-block"><h1 className="page-title">Fill-up</h1><p className="lede">{car.nickname} · {serviceDay(record.date)}</p></div>
    {(await searchParams).saved === "1" && <p className="notice notice--good" role="status">Fill-up saved. Mileage and MPG are up to date.</p>}
    <section className="panel" aria-labelledby="fuel-details"><div className="panel-head"><h2 id="fuel-details">Fill-up details</h2><Link href={`/cars/${car.id}/fuel/${record.id}/edit`}>Edit</Link></div>
      <dl className="specs">
        <div><dt>Date</dt><dd>{serviceDay(record.date)}</dd></div><div><dt>Odometer</dt><dd>{formatMiles(record.miles)} miles</dd></div>
        <div><dt>Gallons pumped</dt><dd>{gallonsValue(record.gallonsMilli)} US gal</dd></div><div><dt>Total paid</dt><dd>{formatMoney(record.totalCents)}</dd></div>
        <div><dt>Tank</dt><dd>{record.fullTank ? "Filled to full" : "Partial fill"}</dd></div><div><dt>Missing fills before this entry</dt><dd>{record.missedFillups ? "Yes" : "No"}</dd></div>
        <div><dt>MPG</dt><dd>{result.mpg === null ? "Unknown" : result.mpg.toFixed(1)}</dd></div>
      </dl><p className="lede">{mpgExplanation(result)}</p>
      {result.mpg !== null && <p className="lede">{gallonsValue(result.gallonsMilli!)} US gallons in this interval.</p>}
    </section>
    {record.notes && <section className="panel" aria-labelledby="fuel-notes"><h2 id="fuel-notes">Notes</h2><p className="fuel-notes">{record.notes}</p></section>}
    <Link className="button button--quiet" href={`/cars/${car.id}/fuel/new`}>Add another fill-up</Link>
    <Link className="button button--quiet fuel-delete-link" href={`/cars/${car.id}/fuel/${record.id}/delete`}>Delete fill-up</Link>
  </main>;
}

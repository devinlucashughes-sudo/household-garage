import { CarHeader } from "@/components/car-header";
import Link from "next/link";
import { carFromParams } from "@/lib/car-page";
import { getDatabase } from "@/lib/db";
import { servicesFor } from "@/lib/services";
import { ServiceRows } from "@/components/service-rows";

export default async function ServiceHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { car } = await carFromParams(params);
  const db = getDatabase();
  const records = servicesFor(db, car.id);
  const quotes = servicesFor(db, car.id, "quote");
  return <main className="page">
    <CarHeader car={car} section="record" />
    <Link className="button button--wide" href={`/cars/${car.id}/services/new`}>Add service</Link>
    <section className="panel" aria-labelledby="completed-services">
      <h2 id="completed-services">Completed work</h2>
      {records.length ? <ServiceRows carId={car.id} records={records} /> : <p className="lede">No service records yet. Add past maintenance using the date it was done.</p>}
    </section>
    <section className="panel" aria-labelledby="quotes">
      <div className="panel-head"><h2 id="quotes">Quotes</h2><Link href={`/cars/${car.id}/services/new?kind=quote`}>Add quote</Link></div>
      {quotes.length ? <ServiceRows carId={car.id} records={quotes} /> : <p className="lede">No quotes saved.</p>}
    </section>
  </main>;
}

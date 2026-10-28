import Link from "next/link";
import { ServiceForm } from "@/components/service-form";
import { pageTime } from "@/lib/car-page";
import { dateInputValue } from "@/lib/format";
import { serviceFromParams } from "@/lib/service-page";
import { itemsFor } from "@/lib/services";
import { getDatabase } from "@/lib/db";
import { treadValues } from "@/lib/tire-input";
import { treadFor } from "@/lib/tires";
import { moneyValue } from "@/lib/service-input";

export default async function EditServicePage({ params, searchParams }: { params: Promise<{ id: string; serviceId: string }>; searchParams: Promise<{ complete?: string }> }) {
  const { car, record } = await serviceFromParams(params);
  const complete = record.kind === "quote" && (await searchParams).complete === "1";
  const today = dateInputValue(pageTime());
  const items = itemsFor(record).map((item) => ({ description: item.description, cost: moneyValue(item.costCents) }));
  return <main className="page">
    <Link className="back" href={`/cars/${car.id}/services/${record.id}`}>‹ Service</Link>
    <h1 className="page-title">{complete ? "Record completed work" : record.kind === "quote" ? "Edit quote" : "Edit service"}</h1>
    {complete && <p className="notice">Confirm the actual work, service date, mileage and total paid. Saving moves this quote into completed service history.</p>}
    <ServiceForm carId={car.id} serviceId={record.id} carName={car.nickname} today={today} initial={{
      kind: complete ? "service" : record.kind, title: record.title, category: record.category, date: complete ? today : record.date,
      shop: record.shop ?? "", miles: record.miles === null ? "" : String(record.miles), totalCents: moneyValue(record.totalCents),
      notes: record.notes ?? "", requestKey: record.requestKey, revision: record.revision,
      lineItems: items.length ? items : [{ description: "", cost: "" }], tread: treadValues(treadFor(getDatabase(), record.id)),
    }} />
  </main>;
}

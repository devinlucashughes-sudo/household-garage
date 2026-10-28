import Link from "next/link";
import { deleteReceiptAction } from "@/app/service-actions";
import { ConfirmButton } from "@/components/confirm-button";
import { DeleteService, ReceiptUpload } from "@/components/service-controls";
import { getDatabase } from "@/lib/db";
import { formatFileSize, formatMiles } from "@/lib/format";
import { serviceFromParams } from "@/lib/service-page";
import { getMaintenance } from "@/lib/maintenance";
import { itemsFor, receiptsFor } from "@/lib/services";
import { TreadCorners } from "@/components/tire-views";
import { treadFor } from "@/lib/tires";
import { formatMoney, MAX_RECEIPTS, serviceDay } from "@/lib/service-input";
import { categoryInfo } from "@/lib/cost-categories";

/** Photos every browser can draw get a preview; PDFs and HEIC stay as file links. */
const PREVIEWABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export default async function ServicePage({ params, searchParams }: { params: Promise<{ id: string; serviceId: string }>; searchParams?: Promise<{ done?: string }> }) {
  const { car, record } = await serviceFromParams(params);
  const doneId = (await searchParams)?.done;
  // Arriving from Mark done: confirm which schedule now counts from this work.
  const done = doneId && /^\d+$/.test(doneId) ? getMaintenance(getDatabase(), car.id, Number(doneId)) : null;
  const receipts = receiptsFor(getDatabase(), record.id);
  const items = itemsFor(record);
  const tread = treadFor(getDatabase(), record.id);
  const quote = record.kind === "quote";
  const path = `/cars/${car.id}/services/${record.id}`;
  return <main className="page">
    <Link className="back" href={`/cars/${car.id}/services`}>‹ {car.nickname}&apos;s record</Link>
    <div className="title-block"><h1 className="page-title">{record.title}</h1><p className="lede">{car.nickname} · {quote ? "Quote" : "Completed service"}</p></div>
    {done && done.lastServiceId === record.id && <div className="notice notice--good" role="status">
      <p>Marked done. {done.title} now counts from this work, so its reminders stop until it comes due again.</p>
      <Link href={`/cars/${car.id}/maintenance/${done.id}`}>View the schedule</Link>
    </div>}
    {quote && <p className="notice">Quotes do not count as completed work or update the odometer.</p>}
    <section className="panel" aria-labelledby="service-details">
      <div className="panel-head"><h2 id="service-details">{quote ? "Quote details" : "Service details"}</h2><Link href={`${path}/edit`}>Edit</Link></div>
      <dl className="specs">
        <div><dt>{quote ? "Quote date" : "Service date"}</dt><dd>{serviceDay(record.date)}</dd></div>
        <div><dt>Shop or DIY</dt><dd>{record.shop || "Not recorded"}</dd></div>
        <div><dt>Odometer</dt><dd>{record.miles === null ? "Not recorded" : `${formatMiles(record.miles)} miles`}</dd></div>
        <div><dt>Kind of cost</dt><dd>{categoryInfo[record.category].label}</dd></div>
        <div><dt>{quote ? "Quoted total" : "Total paid"}</dt><dd>{record.totalCents === null ? "Not recorded" : formatMoney(record.totalCents)}</dd></div>
      </dl>
      {quote && <Link className="button button--wide" href={`${path}/edit?complete=1`}>Record completed work</Link>}
    </section>
    {items.length > 0 && <section className="panel" aria-labelledby="line-items"><h2 id="line-items">Line items</h2>
      <ul className="rows">{items.map((item, index) => <li className="row service-line-item" key={index}><span>{item.description}</span><span>{item.costCents === null ? "Amount unknown" : formatMoney(item.costCents)}</span></li>)}</ul>
      <p className="lede">The total above is recorded separately and may include tax or fees.</p>
    </section>}
    {tread && <section className="panel" aria-labelledby="service-tread">
      <div className="panel-head"><h2 id="service-tread">Tread depth</h2><Link href={`/cars/${car.id}/tires`}>Tires ›</Link></div>
      <TreadCorners tread={tread} />
    </section>}
    {record.notes && <section className="panel" aria-labelledby="service-notes"><h2 id="service-notes">Notes</h2><p className="service-notes">{record.notes}</p></section>}
    <section className="panel" aria-labelledby="receipts"><h2 id="receipts">Receipts and files</h2>
      {receipts.length > 0 ? <ul className="rows">{receipts.map((receipt) => {
        const url = `/api/cars/${car.id}/services/${record.id}/receipts/${receipt.id}`;
        return <li className="receipt-row" key={receipt.id}>
          {PREVIEWABLE.has(receipt.mime) && <a className="receipt-thumb" href={url} target="_blank" rel="noreferrer" aria-label={`Open ${receipt.name}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- signed-in, private photos can't go through the image optimizer */}
            <img src={url} alt="" loading="lazy" />
          </a>}
          <a className="receipt-name" href={url} target="_blank" rel="noreferrer">{receipt.name}<small>{formatFileSize(receipt.size)} · Open file</small></a>
          <div className="receipt-actions"><a href={`${url}?download=1`}>Download</a>
            <ConfirmButton action={deleteReceiptAction.bind(null, car.id, record.id, receipt.id)} question={`Remove "${receipt.name}" from this record?`}>Remove</ConfirmButton>
          </div>
        </li>;
      })}</ul> : <p className="lede">No receipts attached yet.</p>}
      {receipts.length > 0 && <p className="lede">Files open in a new tab. If a photo cannot be displayed on this device, download the original.</p>}
      {receipts.length < MAX_RECEIPTS && <ReceiptUpload carId={car.id} serviceId={record.id} />}
    </section>
    <DeleteService carId={car.id} serviceId={record.id} revision={record.revision} title={record.title} />
  </main>;
}

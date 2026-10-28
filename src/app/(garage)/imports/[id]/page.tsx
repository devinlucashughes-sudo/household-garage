import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/lib/db";
import { getCar } from "@/lib/cars";
import { requireUser } from "@/lib/session";
import { getImportDraft, importReceiptsFor } from "@/lib/imports";
import { formatMoney } from "@/lib/service-input";
import { ImportReview } from "@/components/import-controls";
import { servicesFor } from "@/lib/services";
import "@/app/imports.css";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(); const { id } = await params, db = getDatabase();
  const draft = getImportDraft(db, id); if (!draft) notFound();
  const car = getCar(db, draft.carId); if (!car) notFound();
  const data = JSON.parse(draft.payload), files = importReceiptsFor(db, id);
  const recordUrl = draft.approvedRecordId === null ? null : draft.type === "service" ? `/cars/${car.id}/services/${draft.approvedRecordId}` : `/cars/${car.id}/maintenance/${draft.approvedRecordId}`;
  return <main className="page imports-page"><Link href="/imports">Desktop imports</Link><h1 className="page-title">{data.title}</h1>
    <p className="lede">{car.nickname} · {draft.type === "service" ? (data.kind === "quote" ? "Quote" : "Completed service") : "Maintenance schedule"} · {draft.status === "draft" ? "Pending review" : draft.status}</p>
    {draft.sourceLabel && <p>Source: {draft.sourceLabel}</p>}
    <section className="panel"><h2>Saved details</h2>
      <dl className="import-details">{Object.entries(data).filter(([key]) => key !== "title").map(([key, value]) => <div key={key}><dt>{({ kind: "Record kind", date: "Date", shop: "Shop", miles: "Odometer (miles)", totalCents: "Total paid", lineItems: "Line items", notes: "Notes", intervalMiles: "Interval (miles)", intervalMonths: "Interval (months)", baselineDate: "Baseline date", baselineMiles: "Baseline miles", lastServiceId: "Linked service ID", enabled: "Enabled" } as Record<string, string>)[key] ?? key}</dt><dd>{value === null ? "Unknown / not supplied" : typeof value === "boolean" ? (value ? "Yes" : "No") : key === "totalCents" ? formatMoney(value as number) : key === "lineItems" ? (value as { description: string; costCents: number | null }[]).map((i) => `${i.description}: ${i.costCents === null ? "Cost unknown" : formatMoney(i.costCents)}`).join("; ") || "None" : String(value)}</dd></div>)}</dl>
    </section>
    <section className="panel"><h2>Originals</h2>{!files.length ? <p className="lede">No originals attached.</p> : <ul className="rows">{files.map((f) => <li className="row" key={f.id}><a className="import-row-link" href={`/api/imports/${id}/originals/${f.id}`}>{f.name}<small>{Math.ceil(f.size / 1024)} KB</small></a><a href={`/api/imports/${id}/originals/${f.id}?download=1`}>Download</a></li>)}</ul>}</section>
    {draft.status === "draft" ? <ImportReview key={draft.revision} id={id} carId={car.id} revision={draft.revision} payload={draft.payload} type={draft.type} services={draft.type === "maintenance" ? servicesFor(db, car.id).map(({ id, title, date }) => ({ id, title, date })) : []} /> : <section className="panel"><h2>{draft.status === "approved" ? "Import approved" : "Import rejected"}</h2><p>{draft.status === "approved" ? "The record was saved. These source originals remain available here." : "No record was added. This draft and its originals are retained."}</p>{recordUrl && <Link className="button" href={recordUrl}>Open saved record</Link>}</section>}
  </main>;
}

import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteMaintenance } from "@/components/maintenance-controls";
import { MarkDoneSheet } from "@/components/mark-done-sheet";
import { MaintenanceBasis } from "@/components/maintenance-rows";
import { getDatabase } from "@/lib/db";
import { dateInputValue, formatMiles } from "@/lib/format";
import { pageTime } from "@/lib/car-page";
import { mileageFor, readingsFor } from "@/lib/cars";
import { maintenanceDueFor } from "@/lib/maintenance";
import { ledgerLine } from "@/lib/maintenance-ledger";
import { maintenanceFromParams } from "@/lib/maintenance-page";
import "@/app/maintenance.css";

export default async function MaintenanceDetailPage({ params, searchParams }: { params: Promise<{ id: string; maintenanceId: string }>; searchParams?: Promise<{ done?: string; mark?: string }> }) {
  const { car, record } = await maintenanceFromParams(params);
  const due = maintenanceDueFor(getDatabase(), car.id).find(({ schedule }) => schedule.id === record.id);
  if (!due) notFound();
  const path = `/cars/${car.id}/maintenance/${record.id}`;
  const query = await searchParams;
  const done = query?.done === "1";
  // Only a reading taken today is filled in: a saved service mileage becomes an odometer reading, and an
  // estimate above the real odometer would block later readings.
  const today = dateInputValue(pageTime());
  const mileage = mileageFor(readingsFor(getDatabase(), car.id), pageTime());
  const readToday = mileage.kind !== "none" && dateInputValue(mileage.latest.at) === today;
  const milesHint = readToday ? "Filled in from today's odometer reading." : mileage.kind === "estimate"
    ? `Garage estimates about ${formatMiles(mileage.miles)} miles. Enter the odometer reading if you have it.` : "Enter the odometer reading if you have it.";
  const line = ledgerLine(due, mileage.kind === "estimate" ? mileage.milesPerDay : null);
  const where = [line.limit, line.status].filter(Boolean).join(" · ");
  return <main className="page">
    <Link className="back" href={`/cars/${car.id}/maintenance`}>‹ {car.nickname}&apos;s schedules</Link>
    <div className="title-block"><h1 className="page-title">{record.title}</h1>
      <p className="lede">{car.nickname} · {due.state === "needs-baseline" ? "Needs a start date: mark it done once, or set when it was last done" : where}</p></div>
    {done && <p className="notice notice--good" role="status">Marked done. This schedule now counts from that work, so its reminders stop until it comes due again.</p>}
    <MarkDoneSheet openOnLoad={query?.mark === "1"} title={`${car.nickname} · ${record.title}`} urgent={!record.optional && (due.state === "overdue" || due.state === "due-soon")}
      carId={car.id} maintenanceId={record.id} revision={record.revision} today={today}
      miles={readToday ? String(mileage.latest.miles) : ""} milesHint={milesHint} requestKey={randomUUID()} asksTread={record.asksTread} />
    {record.notes && <section className="panel" aria-labelledby="maintenance-notes"><h2 id="maintenance-notes">Notes</h2><p className="maintenance-notes">{record.notes}</p></section>}
    <section className="panel maintenance-panel" aria-labelledby="maintenance-details">
      <div className="panel-head"><h2 id="maintenance-details">Schedule</h2><Link href={`${path}/edit`}>Edit</Link></div>
      <dl className="specs">
        <div><dt>Mile interval</dt><dd>{record.intervalMiles === null ? "Not used" : `${formatMiles(record.intervalMiles)} miles`}</dd></div>
        <div><dt>Month interval</dt><dd>{record.intervalMonths === null ? "Not used" : `${record.intervalMonths} calendar months`}</dd></div>
        <div><dt>State</dt><dd>{record.enabled ? "Enabled" : "Disabled"}</dd></div>
        <div><dt>Tread depth</dt><dd>{record.asksTread ? "Asked for when marked done" : "Not asked"}</dd></div>
        <div><dt>Optional</dt><dd>{record.optional ? "Yes: the owner's manual doesn't call for it" : "No"}</dd></div>
      </dl>
      {due.state === "needs-baseline" && <><Link className="maintenance-text-link" href={`${path}/edit`}>Set or link a baseline</Link>
        {due.currentMiles === null && record.intervalMiles !== null && <Link className="maintenance-text-link" href={`/cars/${car.id}/mileage`}>Add a current odometer reading</Link>}</>}
      {due.linkedService && <Link className="maintenance-text-link" href={`/cars/${car.id}/services/${due.linkedService.id}`}>View last completed service</Link>}
      {record.sourceDraftId && <Link className="maintenance-text-link" href={`/imports/${encodeURIComponent(record.sourceDraftId)}`}>View source import</Link>}
    </section>
    <details className="panel disclosure maintenance-panel"><summary>How this is calculated</summary><MaintenanceBasis due={due} /></details>
    <DeleteMaintenance carId={car.id} maintenanceId={record.id} revision={record.revision} title={record.title} />
  </main>;
}

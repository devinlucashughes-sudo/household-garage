import Link from "next/link";
import { CarHeader } from "@/components/car-header";
import { MaintenanceLedger } from "@/components/maintenance-ledger";
import { carFromParams, pageTime } from "@/lib/car-page";
import { mileageFor, readingsFor } from "@/lib/cars";
import { getDatabase } from "@/lib/db";
import { maintenanceDueFor } from "@/lib/maintenance";
import { groupLedger } from "@/lib/maintenance-ledger";
import "@/app/maintenance.css";

export default async function CarMaintenancePage({ params }: { params: Promise<{ id: string }> }) {
  const { car } = await carFromParams(params);
  const db = getDatabase();
  const now = pageTime();
  const mileage = mileageFor(readingsFor(db, car.id), now);
  const records = maintenanceDueFor(db, car.id, now);
  const groups = groupLedger(records.map((due) => ({ carId: car.id, carName: car.nickname, due })), () => mileage.kind === "estimate" ? mileage.milesPerDay : null);
  return <main className="page">
    <CarHeader car={car} section="plan" back={{ href: `/cars/${car.id}`, label: car.nickname }} />
    <div className="title-block"><h2 className="page-title">All schedules</h2></div>
    <Link className="button button--wide" href={`/cars/${car.id}/maintenance/new`}>Add schedule</Link>
    {records.length ? <MaintenanceLedger groups={groups} /> :
      <section className="panel maintenance-panel"><p className="lede">No schedules yet. Enter your own mile or month intervals and a starting point. No manufacturer intervals or past work are assumed.</p></section>}
    <p className="ledger-note">Due soon: within 500 miles or 30 days, whichever known limit comes first. Schedules do not change service history or odometer readings. <Link href="/maintenance">Household due list</Link></p>
  </main>;
}

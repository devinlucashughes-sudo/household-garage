import Link from "next/link";
import { MaintenanceLedger } from "@/components/maintenance-ledger";
import { pageTime } from "@/lib/car-page";
import { carTone } from "@/lib/car-tone";
import { garage } from "@/lib/cars";
import { getDatabase } from "@/lib/db";
import { householdMaintenanceDue } from "@/lib/maintenance";
import { groupLedger } from "@/lib/maintenance-ledger";
import { requireUser } from "@/lib/session";
import "@/app/maintenance.css";

export default async function MaintenancePage() {
  await requireUser();
  const db = getDatabase();
  const now = pageTime();
  const cars = garage(db, now);
  const pace = new Map(cars.map(({ car, mileage }) => [car.id, mileage.kind === "estimate" ? mileage.milesPerDay : null]));
  const items = householdMaintenanceDue(db, now);
  const groups = groupLedger(items, (carId) => pace.get(carId) ?? null);
  return <main className="page">
    <div className="title-block"><h1 className="page-title">Maintenance due</h1></div>
    {groups.length ? <MaintenanceLedger groups={groups} showCar markDone /> : <section className="panel maintenance-panel">
      <p className="lede">No enabled schedules yet. Add the intervals you choose; no manufacturer schedules are added automatically.</p>
    </section>}
    <p className="ledger-note">Due soon means within 500 miles or 30 days. The first known limit reached decides when work is due. Turned-off schedules stay on each car&apos;s schedule list.</p>
    <section className="panel maintenance-panel" aria-labelledby="maintenance-cars"><h2 id="maintenance-cars">Schedules by car</h2>
      {cars.length ? <ul className="rows">{cars.map(({ car }) => <li className="row" key={car.id}>
        <Link className="maintenance-text-link" href={`/cars/${car.id}/maintenance`}><span className={`tag ${carTone(car.id)}`}>{car.nickname}</span>&nbsp; View or add schedules</Link>
      </li>)}</ul> : <p className="lede">Add a car to the garage before creating a schedule.</p>}
    </section>
  </main>;
}

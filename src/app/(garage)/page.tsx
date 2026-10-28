import { AppIcon } from "@/components/app-icon";
import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { InstallHint } from "@/components/install-hint";
import { LedgerList } from "@/components/maintenance-ledger";
import { pageTime } from "@/lib/car-page";
import { carTone } from "@/lib/car-tone";
import { garage } from "@/lib/cars";
import { getDatabase } from "@/lib/db";
import { formatWeekday, greeting } from "@/lib/format";
import { householdMaintenanceDue } from "@/lib/maintenance";
import { attentionCounts, groupLedger } from "@/lib/maintenance-ledger";
import { importDrafts } from "@/lib/schema";
import { requireUser } from "@/lib/session";

const DUE_SHOWN = 3;
const NEXT_SHOWN = 2;

export default async function GaragePage() {
  const user = await requireUser();
  const now = pageTime();
  const db = getDatabase();
  const cars = garage(db, now);
  const pending = db.select({ count: count() }).from(importDrafts).where(eq(importDrafts.status, "draft")).get()!.count;
  const schedules = householdMaintenanceDue(db, now);
  const pace = new Map(cars.map(({ car, mileage }) => [car.id, mileage.kind === "estimate" ? mileage.milesPerDay : null]));
  const groups = groupLedger(schedules, (carId) => pace.get(carId) ?? null);
  const group = (key: string) => groups.find((g) => g.key === key)?.items ?? [];
  const due = [...group("overdue"), ...group("due-soon")];
  const next = group("upcoming").slice(0, NEXT_SHOWN);
  const all = attentionCounts(schedules);
  const attention = all.overdue + all.soon + all.unknown;
  const shortModel = (title: string | null) => title?.replace(/^(\d{4}) Chevrolet /, "$1 Chevy ") ?? null;

  return (
    <main className="page">
      <header className="home-head">
        <div className="brand"><AppIcon />Household Garage</div>
        <div className="greeting">
          <h1>{greeting(now)}, {user.name}</h1>
          <p>{formatWeekday(now)}{attention > 0 && <> · <strong>{attention} {attention === 1 ? "thing needs" : "things need"} attention</strong></>}</p>
        </div>
      </header>
      <InstallHint />

      {cars.length === 0 ? (
        <section className="panel" aria-labelledby="cars">
          <h2 id="cars">Cars</h2>
          <div className="empty">
            <p>No cars yet.</p>
            <p className="lede">Add each car with its VIN, and the year, make and model fill in.</p>
          </div>
          <Link className="button button--wide" href="/cars/new">Add a car</Link>
        </section>
      ) : (
        <>
          <ul className="car-list" aria-label="Cars">
            {cars.map(({ car, mileage }) => {
              const counts = attentionCounts(schedules.filter((item) => item.carId === car.id));
              const model = [car.year, car.make, car.model].filter(Boolean).join(" ");
              return (
                <li key={car.id}>
                  <Link className={`car-card ${carTone(car.id)}`} href={`/cars/${car.id}`}>
                    <span className="car-card-name">{car.nickname}</span>
                    {model && <span className="car-card-model">{shortModel(model)}</span>}
                    {mileage.kind === "none" ? <span className="car-card-rate">No odometer reading yet</span> : <>
                      <span className="car-card-miles">{mileage.miles.toLocaleString("en-US")}<small>{mileage.kind === "estimate" ? "est. miles" : "miles"}</small></span>
                      {mileage.kind === "estimate" && <span className="car-card-rate">about {Math.round(mileage.milesPerDay)} mi a day</span>}
                    </>}
                    <span className="chips">
                      {counts.overdue > 0 && <span className="chip chip--due">{counts.overdue} overdue</span>}
                      {counts.soon > 0 && <span className="chip chip--soon">{counts.soon} due soon</span>}
                      {counts.unknown > 0 && <span className="chip chip--unknown">{counts.unknown} needs a date</span>}
                      {counts.total > 0 && counts.overdue + counts.soon + counts.unknown === 0 && <span className="chip">All caught up</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {cars.length < 2 && <Link className="button button--quiet button--wide" href="/cars/new">Add a car</Link>}

          {due.length > 0 && <section className="ledger-section" aria-labelledby="home-due">
            <div className="section-head"><h2 id="home-due" className="is-due">Overdue{all.soon ? " and due soon" : ""} · {due.length}</h2><Link href="/maintenance">All due ›</Link></div>
            <LedgerList items={due.slice(0, DUE_SHOWN)} showCar compact
              more={due.length > DUE_SHOWN ? { href: "/maintenance", label: `${due.length - DUE_SHOWN} more` } : undefined} />
          </section>}
          {next.length > 0 && <section className="ledger-section" aria-labelledby="home-next">
            <div className="section-head"><h2 id="home-next">Next up</h2>{due.length === 0 && <Link href="/maintenance">All due ›</Link>}</div>
            <LedgerList items={next} showCar compact />
          </section>}
          {schedules.length === 0 && <p className="lede">No maintenance schedules yet. Add your own intervals from a car&apos;s page.</p>}

          <Link className="button button--quiet button--wide" href="/imports">{pending ? `Review imports (${pending})` : "Import records"}</Link>
        </>
      )}
    </main>
  );
}

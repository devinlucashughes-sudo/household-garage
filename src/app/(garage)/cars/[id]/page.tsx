import Link from "next/link";
import { retryVinLookup } from "@/app/car-actions";
import { CarHeader } from "@/components/car-header";
import { MaintenanceLedger } from "@/components/maintenance-ledger";
import { ServiceRows } from "@/components/service-rows";
import { carFromParams, pageTime } from "@/lib/car-page";
import { mileageFor, readingsFor, referenceOf, vinDetailsOf } from "@/lib/cars";
import { getDatabase } from "@/lib/db";
import { formatDay } from "@/lib/format";
import { maintenanceDueFor } from "@/lib/maintenance";
import { groupLedger } from "@/lib/maintenance-ledger";
import { referenceLines } from "@/lib/reference";
import { formatMoney } from "@/lib/service-input";
import { servicesFor } from "@/lib/services";
import { projectionWords } from "@/components/tire-views";
import { tireSummary } from "@/lib/tires";
import { vinLooksWrong } from "@/lib/vin";

export default async function CarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vin?: string }>;
}) {
  const { car } = await carFromParams(params);
  const now = pageTime();
  const db = getDatabase();
  const mileage = mileageFor(readingsFor(db, car.id), now);
  const card = referenceLines(referenceOf(car));
  const decoded = vinDetailsOf(car);
  const services = servicesFor(db, car.id);
  const spent = services.reduce((sum, record) => sum + (record.totalCents ?? 0), 0);
  const schedules = maintenanceDueFor(db, car.id, now).map((due) => ({ carId: car.id, carName: car.nickname, due }));
  const groups = groupLedger(schedules.filter(({ due }) => due.state !== null), () => mileage.kind === "estimate" ? mileage.milesPerDay : null);
  const turnedOff = schedules.length - schedules.filter(({ due }) => due.state !== null).length;
  const tires = tireSummary(db, car.id, now);
  const tread = projectionWords(tires.projection);
  const lookupFailed = (await searchParams).vin === "failed" || (car.vin && !decoded);

  const details = [
    { label: "VIN", value: car.vin, mono: true },
    { label: "Engine", value: car.engine },
    { label: "Transmission", value: decoded?.transmission },
    { label: "Drive", value: decoded?.drive },
    { label: "Body", value: decoded?.body },
    { label: "Fuel", value: decoded?.fuel },
    { label: "Color", value: car.color },
    { label: "Plate", value: car.plate, mono: true },
    { label: "Built in", value: decoded?.plant },
  ].filter((d) => d.value);

  return (
    <main className="page">
      <CarHeader car={car} section="plan" />

      {lookupFailed && (
        <div className="notice notice--error" role="status">
          <p>The VIN couldn&rsquo;t be looked up just now, so nothing was filled in from it.</p>
          <form action={retryVinLookup.bind(null, car.id)}>
            <button type="submit" className="link-button">
              Try the lookup again
            </button>
          </form>
        </div>
      )}
      {decoded && vinLooksWrong(decoded) && (
        <p className="notice notice--error">
          NHTSA had trouble with this VIN{decoded.errorText ? ` (${decoded.errorText})` : ""}. Check it against
          the car and fix it under Edit details.
        </p>
      )}

      {groups.length > 0 ? <MaintenanceLedger groups={groups} markDone /> : (
        <section className="panel" aria-labelledby="plan-empty">
          <h2 id="plan-empty">Maintenance plan</h2>
          <p className="lede">No schedules yet. Enter your own mile or month intervals and a starting point.</p>
        </section>
      )}
      <p className="ledger-note">
        Due soon means within 500 miles or 30 days; the first limit reached wins.{" "}
        <Link href={`/cars/${car.id}/maintenance/new`}>Add a schedule</Link>
        {schedules.length > 0 && <> · <Link href={`/cars/${car.id}/maintenance`}>All schedules{turnedOff ? ` (${turnedOff} off)` : ""}</Link></>}
      </p>

      <section className="panel" aria-labelledby="service-title">
        <div className="panel-head">
          <h2 id="service-title">Record{services.length ? ` · ${services.length}` : ""}</h2>
          {services.length > 0 && <Link href={`/cars/${car.id}/services`}>{formatMoney(spent)} total ›</Link>}
        </div>
        {services.length > 0 ? <ServiceRows carId={car.id} records={services.slice(0, 3)} /> : <p className="lede">No service records yet.</p>}
        <Link className="button button--quiet button--wide" href={`/cars/${car.id}/services/new`}>Add service</Link>
      </section>

      <section className="panel" aria-labelledby="tires-title">
        <div className="panel-head">
          <h2 id="tires-title">Tires</h2>
          <Link href={`/cars/${car.id}/tires`}>{tires.current.length ? `${tires.current.length} on the car ›` : "Open ›"}</Link>
        </div>
        <div className={`tread-estimate${tread.urgent ? " tread-estimate--due" : ""}`}><strong>{tread.headline}</strong><p>{tread.detail}</p></div>
        {tires.oldTires.length > 0 && <p className="notice notice--error">{tires.oldTires.length === 1 ? "One tire is" : `${tires.oldTires.length} tires are`} more than six years old by the DOT date. Have them replaced.</p>}
      </section>

      <section className="panel" aria-labelledby="reference-title" id="reference">
        <div className="panel-head">
          <h2 id="reference-title">Quick reference</h2>
          {card.length > 0 && <Link href={`/cars/${car.id}/reference`}>Edit</Link>}
        </div>
        {card.length === 0 ? (
          <>
            <p className="lede">Oil, filters, tires, wipers, bulbs and battery, for the parts counter.</p>
            <Link className="button button--quiet button--wide" href={`/cars/${car.id}/reference`}>
              Fill in the card
            </Link>
          </>
        ) : (
          card.map((group) => (
            <div className="spec-group" key={group.title}>
              <h3 className="label">{group.title}</h3>
              <dl className="specs">
                {group.lines.map((line, i) => (
                  <div key={`${line.label}-${i}`}>
                    <dt>{line.label}</dt>
                    <dd>{line.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))
        )}
      </section>

      <section className="panel" aria-labelledby="details">
        <div className="panel-head">
          <h2 id="details">Details</h2>
          <Link href={`/cars/${car.id}/edit`}>Edit</Link>
        </div>
        {details.length > 0 ? (
          <dl className="specs">
            {details.map((d) => (
              <div key={d.label}>
                <dt>{d.label}</dt>
                <dd className={d.mono ? "mono" : undefined}>{d.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="lede">Add the VIN under Edit and the details fill in.</p>
        )}
        {car.notes && <p style={{ whiteSpace: "pre-line" }}>{car.notes}</p>}
        {decoded && car.vinDecodedAt && (
          <p className="odometer-basis">VIN looked up at NHTSA on {formatDay(car.vinDecodedAt)}.</p>
        )}
      </section>
    </main>
  );
}

import Link from "next/link";
import { CarHeader } from "@/components/car-header";
import { projectionWords, TireLine, TreadCorners } from "@/components/tire-views";
import { carFromParams, pageTime } from "@/lib/car-page";
import { getDatabase } from "@/lib/db";
import { formatMiles } from "@/lib/format";
import { serviceDay } from "@/lib/service-input";
import { TREAD_SPOTS } from "@/lib/tire-input";
import { tireSummary } from "@/lib/tires";
import "@/app/tires.css";

export default async function TiresPage({ params }: { params: Promise<{ id: string }> }) {
  const { car } = await carFromParams(params);
  const tires = tireSummary(getDatabase(), car.id, pageTime());
  const estimate = projectionWords(tires.projection);
  const latest = tires.checks.at(-1);
  const check = tires.treadSchedule
    ? { href: `/cars/${car.id}/maintenance/${tires.treadSchedule.id}?mark=1`, label: `Record ${tires.treadSchedule.title.toLowerCase()}` }
    : { href: `/cars/${car.id}/services/new`, label: "Record tread depth with a service" };
  return <main className="page">
    <CarHeader car={car} />
    <div className="title-block"><h1 className="page-title">Tires</h1></div>

    <section className="panel" aria-labelledby="tread-title">
      <h2 id="tread-title">Tread</h2>
      <div className={`tread-estimate${estimate.urgent ? " tread-estimate--due" : ""}`}><strong>{estimate.headline}</strong><p>{estimate.detail}</p></div>
      {latest && <TreadCorners tread={latest.tread} />}
      <Link className="button button--quiet button--wide" href={check.href}>{check.label}</Link>
    </section>

    <section className="panel" aria-labelledby="tires-on">
      <h2 id="tires-on">On the car</h2>
      {tires.current.length > 0
        ? <ul className="tire-list">{tires.current.map((tire) => <TireLine key={tire.id} carId={car.id} tire={tire} today={tires.today} currentMiles={tires.currentMiles} />)}</ul>
        : <p className="lede">Add the tires on the car now: brand, size and the DOT date from the sidewall.</p>}
      {tires.current.some((tire) => !tire.dot) && <p className="lede">Tap a tire to add its DOT date code from the sidewall, such as 2324 for week 23 of 2024. It shows each tire&rsquo;s age and warns at six years.</p>}
      <Link className="button button--quiet button--wide" href={`/cars/${car.id}/tires/new`}>Add new tires</Link>
    </section>

    {tires.checks.length > 0 && <section className="panel" aria-labelledby="tread-checks">
      <h2 id="tread-checks">Tread checks</h2>
      <ul className="tread-history">{[...tires.checks].reverse().map((c) => <li key={c.serviceId}>
        <Link href={`/cars/${car.id}/services/${c.serviceId}`}>
          <span>{serviceDay(c.date)}<small>{c.title}{c.miles === null ? "" : ` · ${formatMiles(c.miles)} mi`}</small></span>
          <span className="num" aria-label={TREAD_SPOTS.map((s) => `${s.label} ${c.tread[s.key] ?? "not measured"}`).join(", ")}>
            {TREAD_SPOTS.map((s) => c.tread[s.key] ?? "–").join(" · ")}<small>LF · RF · LR · RR</small></span>
        </Link>
      </li>)}</ul>
    </section>}

    {tires.past.length > 0 && <section className="panel" aria-labelledby="tires-past">
      <h2 id="tires-past">Past tires</h2>
      <ul className="tire-list">{tires.past.map((tire) => <TireLine key={tire.id} carId={car.id} tire={tire} today={tires.today} currentMiles={tires.currentMiles} />)}</ul>
    </section>}
  </main>;
}

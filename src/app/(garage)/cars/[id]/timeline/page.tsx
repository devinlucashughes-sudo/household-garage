import Link from "next/link";
import { carFromParams } from "@/lib/car-page";
import { getDatabase } from "@/lib/db";
import { formatMiles } from "@/lib/format";
import { formatMoney, serviceDay } from "@/lib/service-input";
import { timelineFor, TIMELINE_FILTERS, type TimelineFilter } from "@/lib/timeline";

const names: Record<TimelineFilter, string> = { all: "Everything", service: "Completed service", quote: "Quotes", fuel: "Fuel", reading: "Manual mileage" };

export default async function TimelinePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string | string[] }>;
}) {
  const { car } = await carFromParams(params);
  const raw = (await searchParams).kind ?? "all";
  const valid = typeof raw === "string" && (TIMELINE_FILTERS as readonly string[]).includes(raw);
  const filter: TimelineFilter = valid ? raw as TimelineFilter : "all";
  const entries = valid ? timelineFor(getDatabase(), car.id, filter) : [];
  return <main className="page">
    <Link className="back" href={`/cars/${car.id}`}>‹ {car.nickname}</Link>
    <h1 className="page-title">{car.nickname} timeline</h1>
    <p className="lede">Budget fuel payments have no odometer reading.</p>
    <form className="timeline-filter" method="get">
      <label className="field" htmlFor="timeline-kind"><span>Show</span><select className="input" id="timeline-kind" name="kind" defaultValue={filter}>
        {TIMELINE_FILTERS.map((key) => <option value={key} key={key}>{names[key]}</option>)}
      </select></label>
      <button className="button button--quiet" type="submit">Apply</button>
    </form>
    {!valid ? <p className="notice notice--error" role="alert">Choose one of the timeline filters, then apply it.</p>
      : entries.length ? <ol className="timeline-list" aria-label={`${car.nickname} timeline`}>
        {entries.map((entry) => <li className="timeline-entry" key={entry.key}>
          <Link href={entry.href}>
            <div className="timeline-meta"><small>{serviceDay(entry.date)} · {names[entry.kind]}</small>
              {entry.kind !== "reading" && <small>{entry.kind === "quote" ? "Quoted: " : ""}{entry.costCents === null ? "Cost unknown" : formatMoney(entry.costCents)}</small>}
            </div>
            <strong>{entry.title}</strong>
            {entry.description && <small>{entry.description}</small>}
            <small>{entry.miles === null ? "Mileage unknown" : `${formatMiles(entry.miles)} miles`}{entry.mpg === null ? "" : ` · ${entry.mpg.toFixed(1)} MPG`}</small>
          </Link>
        </li>)}
      </ol> : <section className="panel"><p>No {filter === "all" ? "recorded events" : names[filter].toLowerCase()} yet.</p>
        <Link href={`/cars/${car.id}/services/new`}>Add service</Link>
        <Link href={`/cars/${car.id}/fuel/new`}>Add fill-up</Link>
      </section>}
  </main>;
}

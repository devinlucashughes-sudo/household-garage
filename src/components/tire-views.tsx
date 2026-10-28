import Link from "next/link";
import { formatMiles } from "@/lib/format";
import { serviceDay } from "@/lib/service-input";
import { LEGAL_MIN_32NDS, positionLabel, REPLACE_AT_32NDS, TIRE_AGE_LIMIT_YEARS, TREAD_SPOTS, type TreadDepths } from "@/lib/tire-input";
import { tireAge, type Tire, type TreadProjection } from "@/lib/tires";
import "@/app/tires.css";

const tone = (depth: number | null) => depth === null ? "" : depth <= REPLACE_AT_32NDS ? " tread-corner--due" : depth <= REPLACE_AT_32NDS + 2 ? " tread-corner--soon" : "";

/** The four depths as the car sits, fronts on top, worn corners colored. */
export function TreadCorners({ tread }: { tread: TreadDepths }) {
  return <div className="tread-corners" role="list" aria-label="Tread depth by position">
    {TREAD_SPOTS.map((spot) => <div className={`tread-corner${tone(tread[spot.key])}`} role="listitem" key={spot.key}>
      <small>{spot.label}</small>
      <strong className="num">{tread[spot.key] === null ? "—" : <>{tread[spot.key]}<span>/32</span></>}</strong>
    </div>)}
  </div>;
}

const month = (day: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

/** One headline and one line of reasons for the replacement estimate. */
export function projectionWords(projection: TreadProjection): { headline: string; detail: string; urgent: boolean } {
  switch (projection.kind) {
    case "none": return { headline: "No tread readings yet", detail: "Measure all four at the next tread check to start the wear estimate.", urgent: false };
    case "replace-now": return { headline: "Replace now", urgent: true,
      detail: `Lowest tire was ${projection.latest.lowest}/32 on ${serviceDay(projection.latest.date)}. Grip in the wet drops below ${REPLACE_AT_32NDS}/32; ${LEGAL_MIN_32NDS}/32 is the legal minimum.` };
    case "need-more": return { headline: `Lowest ${projection.latest.lowest}/32`, urgent: false,
      detail: `Checked ${serviceDay(projection.latest.date)}. One more check at least ${formatMiles(1000)} miles later gives a replacement estimate.` };
    case "steady": return { headline: `Lowest ${projection.latest.lowest}/32`, urgent: false,
      detail: `No measurable wear between checks yet. Last checked ${serviceDay(projection.latest.date)}.` };
    case "projected": return {
      headline: projection.date ? `Replace around ${month(projection.date)}` : `Replace near ${formatMiles(projection.atMiles)} miles`,
      urgent: false,
      detail: `${projection.date ? `Near ${formatMiles(projection.atMiles)} miles. ` : ""}Wearing about ${projection.wearPer10k.toFixed(1)}/32 every 10,000 miles; lowest ${projection.latest.lowest}/32 on ${serviceDay(projection.latest.date)}.`,
    };
  }
}

const years = (n: number) => n < 1 ? `${Math.max(1, Math.round(n * 12))} months` : `${n.toFixed(1).replace(/\.0$/, "")} years`;

/** What it is, where it went on, how far it has gone, and how old it is. */
export function TireLine({ carId, tire, today, currentMiles }: { carId: number; tire: Tire; today: string; currentMiles: number | null }) {
  const name = [tire.brand, tire.model].filter(Boolean).join(" ") || "Brand not recorded";
  const age = tireAge(tire, today);
  const endMiles = tire.removedDate === null ? currentMiles : tire.removedMiles;
  const driven = endMiles !== null && tire.installedMiles !== null ? endMiles - tire.installedMiles : null;
  const facts = [
    tire.size,
    tire.removedDate === null ? `On since ${serviceDay(tire.installedDate)}` : `${serviceDay(tire.installedDate)} to ${serviceDay(tire.removedDate)}`,
    driven !== null && driven >= 0 ? `${formatMiles(driven)} mi${tire.removedDate === null && currentMiles !== null ? " so far" : ""}` : null,
  ].filter(Boolean);
  return <li className="tire-row">
    <Link className="tire-link" href={`/cars/${carId}/tires/${tire.id}`}>
      <span className="tire-spot">{tire.position === null ? "?" : tire.position === "spare" ? "Spare" : tire.position.toUpperCase()}</span>
      <span className="tire-what"><strong>{name}</strong><small>{positionLabel(tire.position)} · {facts.join(" · ")}</small>
        {tire.removedDate === null && age.kind === "dot" && <small className={age.old ? "tire-age tire-age--old" : "tire-age"}>
          Made {years(age.years)} ago (DOT {tire.dot}){age.old ? `: past ${TIRE_AGE_LIMIT_YEARS} years, have them replaced` : ""}
        </small>}
      </span>
      <span aria-hidden="true" className="tire-chevron">›</span>
    </Link>
  </li>;
}

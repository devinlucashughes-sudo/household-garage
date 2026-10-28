import Link from "next/link";
import { deleteReadingAction } from "@/app/car-actions";
import { ConfirmButton } from "@/components/confirm-button";
import { ReadingForm } from "@/components/reading-form";
import { carFromParams, pageTime } from "@/lib/car-page";
import { readingsFor, type ReadingSource } from "@/lib/cars";
import { getDatabase } from "@/lib/db";
import { dateInputValue, formatMiles, formatShortDay } from "@/lib/format";
import { users } from "@/lib/schema";

const sourceWords: Record<ReadingSource, string> = {
  manual: "Typed in",
  "fill-up": "Fill-up",
  service: "Service",
};

export default async function MileagePage({ params }: { params: Promise<{ id: string }> }) {
  const { car } = await carFromParams(params);
  const db = getDatabase();
  const readings = readingsFor(db, car.id);
  const names = new Map(db.select().from(users).all().map((u) => [u.id, u.name]));
  const now = pageTime();

  return (
    <main className="page">
      <Link className="back" href={`/cars/${car.id}`}>
        ‹ {car.nickname}
      </Link>
      <h1 className="page-title">Update mileage</h1>
      <ReadingForm carId={car.id} today={dateInputValue(now)} />

      {readings.length > 0 && (
        <section className="panel" aria-labelledby="readings">
          <h2 id="readings">Readings</h2>
          <ul className="rows">
            {readings.map((r) => (
              <li className="row" key={r.id}>
                <span>
                  {formatMiles(r.miles)}
                  <small>
                    {formatShortDay(r.readAt, now)} · {sourceWords[r.source]}
                    {r.source === "manual" && r.createdBy && names.get(r.createdBy)
                      ? ` by ${names.get(r.createdBy)}`
                      : ""}
                    {r.source === "service" && r.sourceId && <Link href={`/cars/${car.id}/services/${r.sourceId}`}> · View service</Link>}
                  </small>
                </span>
                {r.source === "manual" && (
                  <ConfirmButton
                    action={deleteReadingAction.bind(null, car.id, r.id)}
                    question={`Delete the ${formatMiles(r.miles)} reading from ${formatShortDay(r.readAt, now)}?`}
                  >
                    Delete
                  </ConfirmButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

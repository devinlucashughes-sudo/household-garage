import Link from "next/link";
import { pageTime } from "@/lib/car-page";
import { carTone } from "@/lib/car-tone";
import { carTitle, mileageFor, readingsFor, type Car } from "@/lib/cars";
import { getDatabase } from "@/lib/db";
import { mileageWords } from "@/lib/mileage-text";
import { servicesFor } from "@/lib/services";

export type CarSection = "plan" | "record" | "fuel" | "costs";

/** The top of every car page: name, Mileage Clock, and the four sections of the car. */
export function CarHeader({ car, section, back }: { car: Car; section?: CarSection; back?: { href: string; label: string } }) {
  const now = pageTime();
  const db = getDatabase();
  const mileage = mileageFor(readingsFor(db, car.id), now);
  const words = mileageWords(mileage, now);
  const pace = mileage.kind === "estimate" ? ` · about ${Math.round(mileage.milesPerDay)} a day` : "";
  const services = servicesFor(db, car.id).length;
  const sections = [
    { key: "plan", label: "Plan", href: `/cars/${car.id}` },
    { key: "record", label: services ? `Record · ${services}` : "Record", href: `/cars/${car.id}/services` },
    { key: "fuel", label: "Fuel", href: `/cars/${car.id}/fuel` },
    { key: "costs", label: "Costs", href: `/cars/${car.id}/costs` },
  ] satisfies { key: CarSection; label: string; href: string }[];
  const go = back ?? (section === "plan" ? { href: "/", label: "Home" } : { href: `/cars/${car.id}`, label: car.nickname });
  return <>
    <Link className="back" href={go.href}>‹ {go.label}</Link>
    <header className={`car-head ${carTone(car.id)}`}>
      <div className="car-head-name"><h1>{car.nickname}</h1>{carTitle(car) && <span>{carTitle(car)}</span>}</div>
      <div className="car-head-miles">
        {words.headline && <strong>{words.headline}</strong>}
        <span>{words.headline ? `${words.isEstimate ? "est. " : ""}mi${pace} · ${words.basis}` : words.basis}</span>
      </div>
      <nav className="car-head-links" aria-label={`${car.nickname} actions`}>
        <Link href={`/cars/${car.id}/mileage`}>Update mileage</Link>
        <Link href={`/cars/${car.id}/timeline`}>Timeline</Link>
      </nav>
    </header>
    <nav className={`seg ${carTone(car.id)}`} aria-label={`${car.nickname} sections`}>
      {sections.map((item) => <Link key={item.key} href={item.href} aria-current={section === item.key ? "page" : undefined}>{item.label}</Link>)}
    </nav>
  </>;
}

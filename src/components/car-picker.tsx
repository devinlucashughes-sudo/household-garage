import Link from "next/link";
import { carTone } from "@/lib/car-tone";
import { reportQuery, type CarCostReport, type ReportPeriod } from "@/lib/reports";

/** All cars or one car on the Costs tab. The year stays picked when the car changes. */
export function CarPicker({ cars, selected, period }: { cars: CarCostReport[]; selected: number | null; period: ReportPeriod }) {
  return <nav className="cost-car-pick" aria-label="Car">
    <Link href={`/reports${reportQuery(period)}`} aria-current={selected === null ? "page" : undefined} scroll={false}>All cars</Link>
    {cars.map((car) => <Link key={car.carId} className={carTone(car.carId)} href={`/reports${reportQuery(period, car.carId)}`}
      aria-current={selected === car.carId ? "page" : undefined} scroll={false}><i aria-hidden="true" /><span>{car.nickname}</span></Link>)}
  </nav>;
}

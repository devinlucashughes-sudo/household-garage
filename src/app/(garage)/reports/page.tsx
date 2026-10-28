import Link from "next/link";
import { CarPicker } from "@/components/car-picker";
import { CarCosts, CategoryBreakdown, countOf, CostHero, formatDollars, periodWords, pillYears, shareOf, ShareBar, WhatsCounted, YearChart } from "@/components/cost-views";
import { PeriodPills } from "@/components/period-pills";
import { carTone } from "@/lib/car-tone";
import { getDatabase } from "@/lib/db";
import { reportCarFromSearch, reportPeriodFromSearch, reportQuery, reportsFor, type ReportSearch } from "@/lib/reports";
import { requireUser } from "@/lib/session";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<ReportSearch> }) {
  await requireUser();
  const search = await searchParams;
  const period = reportPeriodFromSearch(search);
  const report = reportsFor(getDatabase(), period);
  const query = reportQuery(period);
  const many = report.cars.length > 1;
  // An unknown car in the address shows all cars rather than an error.
  const car = many ? report.cars.find((item) => item.carId === reportCarFromSearch(search)) : undefined;
  return <main className="page cost-page">
    <div className="title-block"><h1 className="page-title">Costs</h1></div>
    {report.cars.length === 0 ? <p className="notice">No cars in the garage yet. Add a car to start recording fill-ups and service.</p> : <>
      {many && <CarPicker cars={report.cars} selected={car?.carId ?? null} period={period} />}
      {car ? <CarCosts report={car} period={period} href={`/reports?car=${car.carId}`} kindHref={(category) => `/reports/${category}${reportQuery(period, car.carId)}`} /> : <>
        <PeriodPills href="/reports" years={pillYears(report.years)} selected={period.kind === "year" ? period.year : null} />
        <CostHero label={`${many ? "Both cars" : report.cars[0].nickname}, ${periodWords(period)}`} totals={report.totals} period={period}>
          {many && <>
            <ShareBar parts={report.cars.map((item) => ({ key: String(item.carId), cents: item.totals.knownCents, className: carTone(item.carId) }))} />
            <ul className="cost-rows">{report.cars.map((item) => {
              const share = shareOf(item.totals.knownCents, report.totals.knownCents);
              return <li key={item.carId}><Link className={`cost-row ${carTone(item.carId)}`} href={`/reports${reportQuery(period, item.carId)}`} scroll={false}>
                <span className="tag">{item.nickname}</span>
                <span className="cost-name"><small>{countOf(item.totals.count, "record", "records")}</small></span>
                <span className="cost-amount"><b>{formatDollars(item.totals.knownCents)}</b>{share && <small>{share}</small>}</span>
              </Link></li>;
            })}</ul>
          </>}
        </CostHero>
        {report.totals.count > 0 && <>
          <div className="section-head"><h2>Where it went</h2></div>
          <section className="panel" aria-label="Where it went">
            <CategoryBreakdown totals={report.totals} href={(category) => `/reports/${category}${query}`} />
          </section>
        </>}
        <YearChart years={report.years} period={period} href="/reports" />
        <WhatsCounted />
      </>}
    </>}
  </main>;
}

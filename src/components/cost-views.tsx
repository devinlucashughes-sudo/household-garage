import Link from "next/link";
import { CategoryIcon } from "./category-icon";
import { PeriodPills } from "./period-pills";
import { categoryInfo, COST_CATEGORIES, type CostCategory } from "@/lib/cost-categories";
import { formatMoney } from "@/lib/service-input";
import { yearHref, type CarCostReport, type CategoryTotal, type CostTotals, type ReportPeriod, type YearTotals } from "@/lib/reports";
import "@/app/reports.css";

/** Totals read in whole dollars; single records keep their cents. */
export const formatDollars = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);

export const countOf = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "37%", "<1%", or nothing when there is no known amount or total to share. */
export function shareOf(cents: number, total: number) {
  if (total <= 0 || cents <= 0) return null;
  return cents > 0 && cents / total < 0.005 ? "<1%" : `${Math.round((cents / total) * 100)}%`;
}

/** "13¢" or "$1.20". */
export const formatPerMile = (cents: number) => cents < 0.5 ? "under 1¢" : cents < 99.5 ? `${Math.round(cents)}¢` : formatMoney(Math.round(cents));

/** A kind whose records all lack a price shows that, not $0. */
const amountOf = (total: Pick<CategoryTotal, "cents" | "count" | "unknownCount">) =>
  total.cents === 0 && total.count > 0 && total.unknownCount === total.count ? "No price" : formatDollars(total.cents);

/** Years that have records, newest first, for the period pills. */
export const pillYears = (years: YearTotals[]) => years.filter((year) => year.count > 0).map((year) => year.year).reverse();

export const periodWords = (period: ReportPeriod) => period.kind === "year" ? `in ${period.year}` : "all time";

/** The big number at the top. Children go under it: the category breakdown on a car, the split by car on the Costs tab. */
export function CostHero({ label, totals, sub, period, children }: { label: string; totals: CostTotals; sub?: string; period: ReportPeriod; children?: React.ReactNode }) {
  return <section className="panel cost-hero" aria-label={label}>
    <p className="cost-hero-label">{label}</p>
    <p className="cost-hero-total">{formatDollars(totals.knownCents)}</p>
    {totals.count === 0
      ? <p className="cost-hero-sub">Nothing recorded {period.kind === "year" ? `in ${period.year}` : "yet"}. Fill-ups and completed services show up here.</p>
      : <>{sub && <p className="cost-hero-sub">{sub}</p>}{children}<UnpricedNote totals={totals} /></>}
  </section>;
}

function UnpricedNote({ totals }: { totals: CostTotals }) {
  if (!totals.unknownCount) return null;
  return <p className="cost-note">{countOf(totals.unknownCount, "record has", "records have")} no price yet, so {totals.unknownCount === 1 ? "it isn't" : "they aren't"} in this total.</p>;
}

/** Shares as one bar. Decorative: the rows beside it carry every number. */
export function ShareBar({ parts }: { parts: { key: string; cents: number; className: string }[] }) {
  const shown = parts.filter((part) => part.cents > 0);
  if (!shown.length) return null;
  return <div className="share-bar" aria-hidden="true">{shown.map((part) => <span key={part.key} className={part.className} style={{ flexGrow: part.cents }} />)}</div>;
}

/** The bar and a row per kind of cost, each opening that kind's records. */
export function CategoryBreakdown({ totals, href }: { totals: CostTotals; href: (category: CostCategory) => string }) {
  return <>
    <ShareBar parts={totals.categories.map((total) => ({ key: total.category, cents: total.cents, className: `cat-${total.category}` }))} />
    <ul className="cost-rows">{totals.categories.map((total) => {
      const info = categoryInfo[total.category];
      const share = shareOf(total.cents, totals.knownCents);
      return <li key={total.category}><Link className={`cost-row cat-${total.category}`} href={href(total.category)}>
        <span className="cost-swatch"><CategoryIcon category={total.category} /></span>
        <span className="cost-name"><b>{info.label}</b><small>{countOf(total.count, info.one, info.many)}{total.unknownCount > 0 && ` · ${total.unknownCount} no price`}</small></span>
        <span className="cost-amount"><b>{amountOf(total)}</b>{share && <small>{share}</small>}</span>
      </Link></li>;
    })}</ul>
  </>;
}

const CHART_HEIGHT = 140;

/** A column per calendar year, stacked by kind of cost. Each column opens that year; the open year opens all time again. */
export function YearChart({ years, period, href }: { years: YearTotals[]; period: ReportPeriod; href: string }) {
  if (years.length < 2) return null;
  const max = Math.max(1, ...years.map((year) => year.knownCents));
  const selected = period.kind === "year" ? period.year : null;
  // Past a dozen columns the labels would touch, so every other year is labeled (always the newest and the open one).
  const sparse = years.length > 12;
  const kinds = new Set(years.flatMap((year) => year.categories.filter((total) => total.cents > 0).map((total) => total.category)));
  return <section className="panel year-chart-panel" aria-labelledby="year-chart-heading">
    <h2 id="year-chart-heading">Year by year</h2>
    <div className="year-chart">
      {years.map((year, index) => {
        const open = year.year === selected;
        const label = !sparse || open || (years.length - 1 - index) % 2 === 0;
        return <Link key={year.year} className="year-col" href={open ? href : yearHref(href, year.year)} scroll={false}
          data-state={selected ? (open ? "open" : "dim") : undefined} aria-current={open ? "page" : undefined}
          aria-label={`${year.year}: ${year.count ? formatDollars(year.knownCents) : "nothing recorded"}`}>
          <span className="year-col-amount">{open ? formatDollars(year.knownCents) : ""}</span>
          <span className="year-col-bar" style={{ height: Math.round((year.knownCents / max) * CHART_HEIGHT) }}>
            {year.categories.filter((total) => total.cents > 0).map((total) => <i key={total.category} className={`cat-${total.category}`} style={{ flexGrow: total.cents }} />)}
          </span>
          <span className="year-col-label">{label ? `’${year.year.slice(2)}` : ""}</span>
        </Link>;
      })}
    </div>
    <ul className="cost-legend">{COST_CATEGORIES.filter((category) => kinds.has(category)).map((category) =>
      <li key={category} className={`cat-${category}`}><i />{categoryInfo[category].label}</li>)}</ul>
  </section>;
}

/** One car's costs under its period pills: the total and cost per mile, the split by kind, and the years. */
export function CarCosts({ report, period, href, kindHref }: { report: CarCostReport; period: ReportPeriod; href: string; kindHref: (category: CostCategory) => string }) {
  const perMile = report.mileage.knownCentsPerMile;
  const sub = [perMile !== null && `about ${formatPerMile(perMile)} a mile`, countOf(report.totals.count, "record", "records")].filter(Boolean).join(" · ");
  return <>
    <PeriodPills href={href} years={pillYears(report.years)} selected={period.kind === "year" ? period.year : null} />
    <CostHero label={`Spent on ${report.nickname}, ${periodWords(period)}`} totals={report.totals} sub={sub} period={period}>
      <CategoryBreakdown totals={report.totals} href={kindHref} />
    </CostHero>
    <YearChart years={report.years} period={period} href={href} />
    <WhatsCounted />
  </>;
}

export function WhatsCounted() {
  return <details className="disclosure cost-counted">
    <summary>What&apos;s counted</summary>
    <ul>
      <li>Fill-ups, budget fuel payments and completed services. Quotes and import drafts don&apos;t count.</li>
      <li>A service counts once, at its total paid. Its line items aren&apos;t added again.</li>
      <li>Each service has one kind of cost, so an oil change that also replaced the spark plugs counts as an oil change. Change the kind on the service.</li>
      <li>Cost per mile divides the costs between the first and last odometer readings of the period by the miles between them.</li>
      <li>Purchase price, financing and insurance aren&apos;t recorded here.</li>
    </ul>
  </details>;
}

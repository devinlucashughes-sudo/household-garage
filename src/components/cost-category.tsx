import Link from "next/link";
import { CategoryIcon } from "./category-icon";
import { countOf, formatDollars, pillYears, shareOf } from "./cost-views";
import { PeriodPills } from "./period-pills";
import { carTone } from "@/lib/car-tone";
import { categoryInfo, type CostCategory } from "@/lib/cost-categories";
import { categoryTotal, yearHref, type CostItem, type CostReport } from "@/lib/reports";
import { formatMoney, serviceDay } from "@/lib/service-input";

const monthName = (month: string) => new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
const sum = (items: CostItem[]) => items.reduce((total, item) => total + (item.cents ?? 0), 0);
const groupBy = (items: CostItem[], length: number) => {
  const groups = new Map<string, CostItem[]>();
  for (const item of items) groups.set(item.date.slice(0, length), [...(groups.get(item.date.slice(0, length)) ?? []), item]);
  return [...groups].sort(([a], [b]) => b.localeCompare(a));
};

/**
 * One kind of cost opened from a Costs page: its records by year, newest first. Service records open their page;
 * fuel, with hundreds of fill-ups, reads as a total per month.
 */
export function CostCategoryView({ report, category, base, back, whose }: {
  report: CostReport; category: CostCategory; base: string; back: { href: string; label: string }; whose: string;
}) {
  const info = categoryInfo[category];
  const total = categoryTotal(report.totals, category);
  const items = report.items.filter((item) => item.category === category);
  const names = new Map(report.cars.map((car) => [car.carId, car.nickname]));
  const household = report.cars.length > 1;
  const share = shareOf(total.cents, report.totals.knownCents);
  const when = report.period.kind === "year" ? ` in ${report.period.year}` : "";
  const carTag = (carId: number) => household && <span className={`tag ${carTone(carId)}`}>{names.get(carId)}</span>;
  const years = pillYears(report.years.map((year) => ({ ...year, count: categoryTotal(year, category).count })));
  return <main className="page cost-page">
    <Link className="back" href={back.href}>‹ {back.label}</Link>
    <div className={`title-block cost-category-title cat-${category}`}>
      <span className="cost-chip"><CategoryIcon category={category} />{info.label}</span>
      <h1 className="page-title">{total.count ? `${total.cents === 0 && total.unknownCount ? "No price" : formatDollars(total.cents)} on ${whose}${when}` : `No ${info.many}${when}`}</h1>
      <p className="lede">{total.count
        ? [countOf(total.count, info.one, info.many), total.unknownCount && `${total.unknownCount} with no price`, share && `${share} of ${whose === "both cars" ? "both cars'" : `${whose}'s`} costs${when}`].filter(Boolean).join(" · ")
        : info.hint}</p>
    </div>
    {years.length > 0 && <PeriodPills href={base} years={years} selected={report.period.kind === "year" ? report.period.year : null} />}
    {groupBy(items, 4).map(([year, list]) => <section key={year} aria-labelledby={`cost-year-${year}`} className="cost-year">
      <div className="section-head"><h2 id={`cost-year-${year}`}>{year}</h2><span>{formatDollars(sum(list))}</span></div>
      <div className="panel cost-items">
        {category === "fuel"
          ? groupBy(list, 7).map(([month, fills]) => <div className="cost-item" key={month}>
            <span className="cost-item-main"><b>{monthName(month)}</b><small>{countOf(fills.length, "fill-up", "fill-ups")}
              {household && report.cars.map((car) => {
                const cents = sum(fills.filter((fill) => fill.carId === car.carId));
                return cents > 0 && <span key={car.carId}> · {car.nickname} {formatMoney(cents)}</span>;
              })}</small></span>
            <span className="cost-item-amount">{formatMoney(sum(fills))}</span>
          </div>)
          : list.map((item) => <Link className="cost-item" key={item.serviceId} href={`/cars/${item.carId}/services/${item.serviceId}`}>
            <span className="cost-item-main">{carTag(item.carId)}<b>{item.title}</b><small>{serviceDay(item.date)}{item.shop && ` · ${item.shop}`}</small></span>
            <span className={item.cents === null ? "cost-item-amount is-unknown" : "cost-item-amount"}>{item.cents === null ? "No price" : formatMoney(item.cents)}</span>
          </Link>)}
      </div>
    </section>)}
    {category === "fuel" && !household && report.cars[0] && <Link className="cost-more" href={`/cars/${report.cars[0].carId}/fuel`}>Fill-ups and MPG ›</Link>}
    {report.period.kind === "year" && <Link className="cost-more" href={`${base}`}>See all years ›</Link>}
  </main>;
}

export const backToCosts = (href: string, label: string, report: CostReport) =>
  ({ href: report.period.kind === "year" ? yearHref(href, report.period.year) : href, label });

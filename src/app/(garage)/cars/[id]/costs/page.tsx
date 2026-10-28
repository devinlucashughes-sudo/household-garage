import { CarHeader } from "@/components/car-header";
import { CarCosts } from "@/components/cost-views";
import { carFromParams } from "@/lib/car-page";
import { getDatabase } from "@/lib/db";
import { reportPeriodFromSearch, reportPeriodQuery, reportsFor, type ReportSearch } from "@/lib/reports";

export default async function CarCostsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ReportSearch> }) {
  const { car } = await carFromParams(params);
  const period = reportPeriodFromSearch(await searchParams);
  const report = reportsFor(getDatabase(), period, car.id).cars[0];
  const href = `/cars/${car.id}/costs`;
  return <main className="page cost-page">
    <CarHeader car={car} section="costs" />
    <CarCosts report={report} period={period} href={href} kindHref={(category) => `${href}/${category}${reportPeriodQuery(period)}`} />
  </main>;
}

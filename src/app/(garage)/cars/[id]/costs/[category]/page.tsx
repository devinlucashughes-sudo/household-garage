import { notFound } from "next/navigation";
import { backToCosts, CostCategoryView } from "@/components/cost-category";
import { carFromParams } from "@/lib/car-page";
import { isCostCategory } from "@/lib/cost-categories";
import { getDatabase } from "@/lib/db";
import { reportPeriodFromSearch, reportsFor, type ReportSearch } from "@/lib/reports";
import "@/app/reports.css";

export default async function CarCostCategoryPage({ params, searchParams }: { params: Promise<{ id: string; category: string }>; searchParams: Promise<ReportSearch> }) {
  const { car } = await carFromParams(params);
  const { category } = await params;
  if (!isCostCategory(category)) notFound();
  const report = reportsFor(getDatabase(), reportPeriodFromSearch(await searchParams), car.id);
  return <CostCategoryView report={report} category={category} base={`/cars/${car.id}/costs/${category}`}
    back={backToCosts(`/cars/${car.id}/costs`, `${car.nickname} costs`, report)} whose={car.nickname} />;
}

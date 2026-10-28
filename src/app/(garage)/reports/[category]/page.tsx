import { notFound } from "next/navigation";
import { backToCosts, CostCategoryView } from "@/components/cost-category";
import { isCostCategory } from "@/lib/cost-categories";
import { getDatabase } from "@/lib/db";
import { reportCarFromSearch, reportPeriodFromSearch, reportQuery, reportsFor, type ReportSearch } from "@/lib/reports";
import { requireUser } from "@/lib/session";
import "@/app/reports.css";

export default async function CostCategoryPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<ReportSearch> }) {
  await requireUser();
  const { category } = await params;
  if (!isCostCategory(category)) notFound();
  const search = await searchParams;
  const period = reportPeriodFromSearch(search);
  // A car picked on the Costs tab narrows the kind to that car; an unknown car shows all cars.
  const picked = reportCarFromSearch(search);
  const narrowed = picked === null ? null : reportsFor(getDatabase(), period, picked);
  const carId = narrowed?.cars.length ? picked : null;
  const report = narrowed && carId !== null ? narrowed : reportsFor(getDatabase(), period);
  const whose = report.cars.length === 1 ? report.cars[0].nickname : "both cars";
  const carQuery = reportQuery({ kind: "all" }, carId);
  return <CostCategoryView report={report} category={category} base={`/reports/${category}${carQuery}`}
    back={backToCosts(`/reports${carQuery}`, "Costs", report)} whose={whose} />;
}

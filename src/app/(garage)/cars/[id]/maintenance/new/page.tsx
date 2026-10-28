import { randomUUID } from "node:crypto";
import Link from "next/link";
import { MaintenanceForm } from "@/components/maintenance-form";
import { carFromParams, pageTime } from "@/lib/car-page";
import { getDatabase } from "@/lib/db";
import { dateInputValue } from "@/lib/format";
import { servicesFor } from "@/lib/services";

export default async function NewMaintenancePage({ params }: { params: Promise<{ id: string }> }) {
  const { car } = await carFromParams(params);
  const services = servicesFor(getDatabase(), car.id).map(({ id, title, date, miles }) => ({ id, title, date, miles }));
  return <main className="page">
    <Link className="back" href={`/cars/${car.id}/maintenance`}>‹ Schedules</Link>
    <h1 className="page-title">Add schedule</h1>
    <MaintenanceForm carId={car.id} maintenanceId={null} carName={car.nickname} today={dateInputValue(pageTime())} services={services} initial={{
      title: "", intervalMiles: "", intervalMonths: "", baselineDate: "", baselineMiles: "", lastServiceId: "", enabled: true, optional: false, asksTread: false, notes: "", requestKey: randomUUID(),
    }} />
  </main>;
}

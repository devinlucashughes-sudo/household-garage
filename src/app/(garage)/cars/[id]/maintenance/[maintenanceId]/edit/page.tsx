import Link from "next/link";
import { MaintenanceForm } from "@/components/maintenance-form";
import { pageTime } from "@/lib/car-page";
import { getDatabase } from "@/lib/db";
import { dateInputValue } from "@/lib/format";
import { maintenanceFromParams, maintenanceInitial } from "@/lib/maintenance-page";
import { servicesFor } from "@/lib/services";

export default async function EditMaintenancePage({ params }: { params: Promise<{ id: string; maintenanceId: string }> }) {
  const { car, record } = await maintenanceFromParams(params);
  const services = servicesFor(getDatabase(), car.id).map(({ id, title, date, miles }) => ({ id, title, date, miles }));
  return <main className="page">
    <Link className="back" href={`/cars/${car.id}/maintenance/${record.id}`}>‹ Schedule</Link>
    <h1 className="page-title">Edit schedule</h1>
    <MaintenanceForm carId={car.id} maintenanceId={record.id} carName={car.nickname} today={dateInputValue(pageTime())} services={services} initial={maintenanceInitial(record)} />
  </main>;
}

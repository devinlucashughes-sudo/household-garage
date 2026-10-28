import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ServiceForm } from "@/components/service-form";
import { carFromParams, pageTime } from "@/lib/car-page";
import { dateInputValue } from "@/lib/format";
import { getDatabase } from "@/lib/db";
import { maintenanceDueFor } from "@/lib/maintenance";
import { maintenanceStateLabel } from "@/lib/maintenance-input";

const order = { overdue: 0, "due-soon": 1, "needs-baseline": 2, upcoming: 3 } as const;

export default async function NewServicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { car } = await carFromParams(params);
  const kind = (await searchParams).kind === "quote" ? "quote" : "service";
  const today = dateInputValue(pageTime());
  const completable = maintenanceDueFor(getDatabase(), car.id, pageTime()).filter(({ state }) => state !== null)
    .sort((a, b) => order[a.state!] - order[b.state!] || a.schedule.title.localeCompare(b.schedule.title))
    .map(({ schedule, state }) => ({ id: schedule.id, title: schedule.title, state: maintenanceStateLabel(state) }));
  return <main className="page">
    <Link className="back" href={`/cars/${car.id}/services`}>‹ Record</Link>
    <h1 className="page-title">{kind === "quote" ? "Add quote" : "Add service"}</h1>
    <ServiceForm carId={car.id} serviceId={null} carName={car.nickname} today={today} completable={completable} initial={{
      kind, title: "", category: "", date: today, shop: "", miles: "", totalCents: "", notes: "", requestKey: randomUUID(), lineItems: [{ description: "", cost: "" }],
    }} />
  </main>;
}

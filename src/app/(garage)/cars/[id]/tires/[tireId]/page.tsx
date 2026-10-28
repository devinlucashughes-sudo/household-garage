import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteTire, TireForm } from "@/components/tire-form";
import { carFromParams, pageTime } from "@/lib/car-page";
import { getDatabase } from "@/lib/db";
import { dateInputValue } from "@/lib/format";
import { servicesFor } from "@/lib/services";
import { positionLabel } from "@/lib/tire-input";
import { getTire } from "@/lib/tires";

export default async function TirePage({ params }: { params: Promise<{ id: string; tireId: string }> }) {
  const { car } = await carFromParams(params);
  const { tireId } = await params;
  const db = getDatabase();
  const tire = /^\d+$/.test(tireId) ? getTire(db, car.id, Number(tireId)) : null;
  if (!tire) notFound();
  const services = servicesFor(db, car.id).map(({ id, title, date, miles }) => ({ id, title, date, miles }));
  const number = (n: number | null) => n === null ? "" : String(n);
  return <main className="page">
    <Link className="back" href={`/cars/${car.id}/tires`}>‹ Tires</Link>
    <div className="title-block"><h1 className="page-title">{[tire.brand, tire.model].filter(Boolean).join(" ") || "Tire"}</h1>
      <p className="lede">{car.nickname} · {positionLabel(tire.position)}{tire.removedDate ? " · Removed" : ""}</p></div>
    {tire.serviceId !== null && <Link className="maintenance-text-link" href={`/cars/${car.id}/services/${tire.serviceId}`}>View the service record</Link>}
    <TireForm carId={car.id} tireId={tire.id} revision={tire.revision} today={dateInputValue(pageTime())} services={services} requestKey={randomUUID()} initial={{
      positions: tire.position ? [tire.position] : [], brand: tire.brand ?? "", model: tire.model ?? "", size: tire.size ?? "", dot: tire.dot ?? "",
      installedDate: tire.installedDate, installedMiles: number(tire.installedMiles), serviceId: number(tire.serviceId),
      removedDate: tire.removedDate ?? "", removedMiles: number(tire.removedMiles), notes: tire.notes ?? "",
    }} />
    <DeleteTire carId={car.id} tireId={tire.id} revision={tire.revision} />
  </main>;
}

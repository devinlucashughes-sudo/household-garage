import { randomUUID } from "node:crypto";
import Link from "next/link";
import { TireForm } from "@/components/tire-form";
import { carFromParams, pageTime } from "@/lib/car-page";
import { getDatabase } from "@/lib/db";
import { dateInputValue } from "@/lib/format";
import { referenceOf } from "@/lib/cars";
import { servicesFor } from "@/lib/services";

export default async function NewTiresPage({ params }: { params: Promise<{ id: string }> }) {
  const { car } = await carFromParams(params);
  const today = dateInputValue(pageTime());
  const services = servicesFor(getDatabase(), car.id).map(({ id, title, date, miles }) => ({ id, title, date, miles }));
  return <main className="page">
    <Link className="back" href={`/cars/${car.id}/tires`}>‹ Tires</Link>
    <h1 className="page-title">Add new tires</h1>
    <TireForm carId={car.id} tireId={null} revision={null} today={today} services={services} requestKey={randomUUID()} initial={{
      positions: [], brand: "", model: "", size: referenceOf(car).values.tireSize ?? "", dot: "", installedDate: today, installedMiles: "",
      serviceId: "", removedDate: "", removedMiles: "", notes: "",
    }} />
  </main>;
}

import { FuelForm } from "@/components/fuel-form";
import { pageTime } from "@/lib/car-page";
import { dateInputValue } from "@/lib/format";
import { fuelFormInitial, fuelFromParams } from "@/lib/fuel-page";

export default async function EditFuelPage({ params }: { params: Promise<{ id: string; fuelId: string }> }) {
  const { car, record } = await fuelFromParams(params);
  const today = dateInputValue(pageTime());
  return <main className="page">
    <FuelForm cars={[{ id: car.id, nickname: car.nickname }]} carId={car.id} fuelId={record.id} today={today} title="Edit fill-up"
      intro={`${car.nickname}. Saving updates this fill-up, its mileage reading and any affected MPG intervals.`}
      initial={fuelFormInitial(today, record.requestKey, record)} />
  </main>;
}

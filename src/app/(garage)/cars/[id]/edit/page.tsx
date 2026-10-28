import Link from "next/link";
import { deleteCarAction } from "@/app/car-actions";
import { CarForm } from "@/components/car-form";
import { ConfirmButton } from "@/components/confirm-button";
import { carFromParams } from "@/lib/car-page";

export default async function EditCarPage({ params }: { params: Promise<{ id: string }> }) {
  const { car } = await carFromParams(params);
  const s = (v: string | number | null) => (v === null ? "" : String(v));
  return (
    <main className="page">
      <Link className="back" href={`/cars/${car.id}`}>
        ‹ {car.nickname}
      </Link>
      <h1 className="page-title">Edit details</h1>
      <CarForm
        carId={car.id}
        initial={{
          nickname: car.nickname,
          year: s(car.year),
          make: s(car.make),
          model: s(car.model),
          trim: s(car.trim),
          engine: s(car.engine),
          color: s(car.color),
          plate: s(car.plate),
          vin: s(car.vin),
          notes: s(car.notes),
        }}
      />
      <ConfirmButton
        action={deleteCarAction.bind(null, car.id)}
        question={`Remove ${car.nickname} from the garage? Its mileage readings, service history, quotes, receipts and quick-reference card go too.`}
      >
        Remove this car
      </ConfirmButton>
    </main>
  );
}

import Link from "next/link";
import { ReferenceForm } from "@/components/reference-form";
import { carFromParams } from "@/lib/car-page";
import { referenceOf } from "@/lib/cars";

export default async function ReferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { car } = await carFromParams(params);
  return (
    <main className="page">
      <Link className="back" href={`/cars/${car.id}`}>
        ‹ {car.nickname}
      </Link>
      <div className="title-block">
        <h1 className="page-title">Quick reference</h1>
        <p className="lede">Fill in what you know. Blank boxes stay off the card.</p>
      </div>
      <ReferenceForm carId={car.id} initial={referenceOf(car)} />
    </main>
  );
}

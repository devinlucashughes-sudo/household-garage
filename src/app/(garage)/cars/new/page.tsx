import Link from "next/link";
import { CarForm } from "@/components/car-form";
import { requireUser } from "@/lib/session";

export default async function NewCarPage() {
  await requireUser();
  return (
    <main className="page">
      <Link className="back" href="/">
        ‹ Home
      </Link>
      <h1 className="page-title">Add a car</h1>
      <CarForm carId={null} />
    </main>
  );
}

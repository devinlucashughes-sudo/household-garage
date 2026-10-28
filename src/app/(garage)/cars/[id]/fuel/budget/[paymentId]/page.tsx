import Link from "next/link";
import { notFound } from "next/navigation";
import { getBudgetFuel } from "@/lib/budget-fuel";
import { carFromParams } from "@/lib/car-page";
import { getDatabase } from "@/lib/db";
import { formatMoney, serviceDay } from "@/lib/service-input";

export default async function BudgetFuelPage({ params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { car } = await carFromParams(params);
  const { paymentId } = await params;
  const payment = /^\d+$/.test(paymentId) ? getBudgetFuel(getDatabase(), car.id, Number(paymentId)) : null;
  if (!payment) notFound();
  return <main className="page">
    <Link className="back" href={`/cars/${car.id}/fuel`}>‹ {car.nickname}&apos;s fuel</Link>
    <div className="title-block"><h1 className="page-title">Budget gas payment</h1><p className="lede">{car.nickname} · {serviceDay(payment.date)}</p></div>
    <section className="panel" aria-labelledby="budget-fuel-details"><h2 id="budget-fuel-details">Payment details</h2>
      <dl className="specs">
        <div><dt>Date</dt><dd>{serviceDay(payment.date)}</dd></div>
        <div><dt>Paid to</dt><dd>{payment.payee || "Not recorded"}</dd></div>
        <div><dt>Total paid</dt><dd>{formatMoney(payment.totalCents)}</dd></div>
        <div><dt>Gallons and odometer</dt><dd>Not recorded</dd></div>
      </dl>
      <p className="lede">This payment counts toward fuel costs. It does not add mileage or provide enough information to calculate MPG.</p>
    </section>
    {payment.memo && <section className="panel" aria-labelledby="budget-fuel-memo"><h2 id="budget-fuel-memo">Budget memo</h2><p>{payment.memo}</p></section>}
    <details className="panel"><summary>Budget source</summary><p>{payment.sourceFile}, CSV record {payment.sourceRecord}</p></details>
  </main>;
}

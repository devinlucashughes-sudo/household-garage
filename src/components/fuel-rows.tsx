import Link from "next/link";
import type { FuelRecord } from "@/lib/fuel";
import type { BudgetFuelPayment } from "@/lib/budget-fuel";
import { calculateMpg } from "@/lib/fuel-mpg";
import { gallonsValue } from "@/lib/fuel-input";
import { formatMiles } from "@/lib/format";
import { formatMoney, serviceDay } from "@/lib/service-input";
import "@/app/fuel.css";

export function FuelRows({ carId, records, payments }: { carId: number; records: FuelRecord[]; payments: BudgetFuelPayment[] }) {
  const mpg = new Map(calculateMpg(records, payments).map((result) => [result.id, result]));
  const entries = [
    ...records.map((record) => ({ kind: "fill" as const, record })),
    ...payments.map((record) => ({ kind: "budget" as const, record })),
  ].sort((a, b) => b.record.date.localeCompare(a.record.date) || b.record.id - a.record.id);
  return <ul className="rows fuel-history">{entries.map((entry) => {
    if (entry.kind === "budget") {
      const payment = entry.record;
      return <li key={`budget:${payment.id}`}><Link className="fuel-history-link" href={`/cars/${carId}/fuel/budget/${payment.id}`}>
        <span><strong>{serviceDay(payment.date)}</strong><small>{payment.payee || "Budget payment"}</small><small>Budget payment · gallons and mileage unknown</small></span>
        <span className="fuel-history-total">{formatMoney(payment.totalCents)}<small>MPG unknown</small></span>
      </Link></li>;
    }
    const record = entry.record;
    return <li key={`fill:${record.id}`}><Link className="fuel-history-link" href={`/cars/${carId}/fuel/${record.id}`}>
      <span><strong>{serviceDay(record.date)}</strong><small>{formatMiles(record.miles)} miles</small><small>{gallonsValue(record.gallonsMilli)} US gal · {record.fullTank ? "Full tank" : "Partial fill"}</small>{record.missedFillups && <small>Missing fill-up before this entry</small>}</span>
      <span className="fuel-history-total">{formatMoney(record.totalCents)}<small>{mpg.get(record.id)?.mpg == null ? "MPG unknown" : `${mpg.get(record.id)!.mpg!.toFixed(1)} MPG`}</small></span>
    </Link></li>;
  })}</ul>;
}

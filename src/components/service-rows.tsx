import Link from "next/link";
import type { ServiceRecord } from "@/lib/services";
import { formatMiles } from "@/lib/format";
import { formatMoney, serviceDay } from "@/lib/service-input";

export function ServiceRows({ carId, records }: { carId: number; records: ServiceRecord[] }) {
  return <ul className="rows service-history">{records.map((record) => <li key={record.id}>
    <Link className="service-history-link" href={`/cars/${carId}/services/${record.id}`}>
      <span className="service-history-main"><strong>{record.title}</strong>
        <small>{serviceDay(record.date)}{record.shop ? ` · ${record.shop}` : ""}</small>
        {record.miles !== null && <small>{formatMiles(record.miles)} miles</small>}
      </span>
      <span className="service-history-total">{record.totalCents === null ? "Total unknown" : formatMoney(record.totalCents)}</span>
    </Link>
  </li>)}</ul>;
}

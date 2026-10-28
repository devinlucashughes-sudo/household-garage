import Link from "next/link";
import type { HouseholdMaintenanceDue, MaintenanceDue } from "@/lib/maintenance";
import { maintenanceDay, maintenanceStateLabel } from "@/lib/maintenance-input";
import { formatMiles } from "@/lib/format";
import "@/app/maintenance.css";

export function MaintenanceBasis({ due }: { due: MaintenanceDue }) {
  return <ul className="maintenance-basis">{due.basis.map((line, index) => <li key={index}>{line}</li>)}</ul>;
}

export function MaintenanceRows({ items }: { items: HouseholdMaintenanceDue[] }) {
  return <ul className="rows maintenance-rows">{items.map(({ carId, carName, due }) => <li key={due.schedule.id}>
    <Link className="maintenance-row-link" href={`/cars/${carId}/maintenance/${due.schedule.id}`}>
      <strong>{due.schedule.title}</strong>
      <span className={`maintenance-state${due.state === "overdue" ? " maintenance-state--due" : ""}`}>{maintenanceStateLabel(due.state)}</span>
      <small>{carName}</small>
      <small>{[
        due.schedule.intervalMiles === null ? null : due.dueMiles === null ? "Mileage limit unknown" : `At ${formatMiles(due.dueMiles)} miles`,
        due.schedule.intervalMonths === null ? null : due.dueDate === null ? "Date limit unknown" : `By ${maintenanceDay(due.dueDate)}`,
      ].filter(Boolean).join("; ")}</small>
    </Link>
    <details className="maintenance-basis-details"><summary>How this is calculated</summary><MaintenanceBasis due={due} /></details>
  </li>)}</ul>;
}

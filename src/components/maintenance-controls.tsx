"use client";

import Link from "next/link";
import { useActionState } from "react";
import { deleteMaintenanceAction } from "@/app/maintenance-actions";
import { maintenanceAttempt } from "@/lib/maintenance-client";
import type { MaintenanceFormState } from "@/lib/maintenance-input";
import "@/app/maintenance.css";

export function DeleteMaintenance({ carId, maintenanceId, revision, title }: {
  carId: number; maintenanceId: number; revision: number; title: string;
}) {
  const [state, action, pending] = useActionState((previous: MaintenanceFormState) =>
    maintenanceAttempt(() => deleteMaintenanceAction(carId, maintenanceId, revision, previous)), {} as MaintenanceFormState);
  return <form className="maintenance-delete" action={action} aria-busy={pending}
    onSubmit={(event) => { if (!confirm(`Delete the schedule "${title}"? This cannot be undone.`)) event.preventDefault(); }}>
    {state.message && <p className="field-error" role="alert">{state.message}</p>}
    {state.stale && <Link className="maintenance-text-link" target="_blank" rel="noreferrer" href={`/cars/${carId}/maintenance/${maintenanceId}`}>Open latest schedule in a new tab</Link>}
    <button className="link-button link-button--danger" disabled={pending} type="submit">{pending ? "Deleting..." : "Delete schedule"}</button>
    <p className="lede">Deleting a schedule keeps completed service history and odometer readings.</p>
  </form>;
}

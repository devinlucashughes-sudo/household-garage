import "server-only";
import { notFound } from "next/navigation";
import { carFromParams } from "./car-page";
import { getDatabase } from "./db";
import { getMaintenance } from "./maintenance";
import type { MaintenanceFormInitial } from "./maintenance-input";
import type { MaintenanceSchedule } from "./maintenance";

export async function maintenanceFromParams(params: Promise<{ id: string; maintenanceId: string }>) {
  const { car, user } = await carFromParams(params);
  const { maintenanceId } = await params;
  const record = /^\d+$/.test(maintenanceId) ? getMaintenance(getDatabase(), car.id, Number(maintenanceId)) : null;
  if (!record) notFound();
  return { car, user, record };
}

export function maintenanceInitial(record: MaintenanceSchedule): MaintenanceFormInitial {
  return {
    title: record.title, intervalMiles: record.intervalMiles === null ? "" : String(record.intervalMiles),
    intervalMonths: record.intervalMonths === null ? "" : String(record.intervalMonths),
    baselineDate: record.baselineDate ?? "", baselineMiles: record.baselineMiles === null ? "" : String(record.baselineMiles),
    lastServiceId: record.lastServiceId === null ? "" : String(record.lastServiceId), enabled: record.enabled, optional: record.optional, asksTread: record.asksTread,
    notes: record.notes ?? "", requestKey: record.requestKey, revision: record.revision,
  };
}

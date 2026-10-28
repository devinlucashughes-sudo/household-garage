import "server-only";
import { notFound } from "next/navigation";
import { carFromParams } from "./car-page";
import { getDatabase } from "./db";
import { getService } from "./services";

export async function serviceFromParams(params: Promise<{ id: string; serviceId: string }>) {
  const { car, user } = await carFromParams(params);
  const { serviceId } = await params;
  const record = /^\d+$/.test(serviceId) ? getService(getDatabase(), car.id, Number(serviceId)) : null;
  if (!record) notFound();
  return { car, user, record };
}

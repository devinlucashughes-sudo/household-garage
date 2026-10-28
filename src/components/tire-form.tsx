"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { deleteTireAction, saveTireAction } from "@/app/tire-actions";
import { serviceDay } from "@/lib/service-input";
import { TIRE_SPOTS, type TireFormState } from "@/lib/tire-input";
import "@/app/maintenance.css";
import "@/app/tires.css";

export type TireFormInitial = {
  positions: string[]; brand: string; model: string; size: string; dot: string; installedDate: string; installedMiles: string;
  serviceId: string; removedDate: string; removedMiles: string; notes: string;
};
export type TireServiceOption = { id: number; title: string; date: string; miles: number | null };

/**
 * Adding tires names every position they went on (one row each, the old tire at each position comes
 * off that day). Editing one tire adds when it came off.
 */
export function TireForm({ carId, tireId, revision, today, initial, services, requestKey }: {
  carId: number; tireId: number | null; revision: number | null; today: string; initial: TireFormInitial;
  services: TireServiceOption[]; requestKey: string;
}) {
  const [state, action, pending] = useActionState(saveTireAction.bind(null, carId, tireId, revision), {} as TireFormState);
  const [values, setValues] = useState(initial);
  const adding = tireId === null;
  const errors = state.errors ?? {};
  const set = (key: keyof TireFormInitial, value: string | string[]) => setValues({ ...values, [key]: value });
  // Picking the service record fills in its date and mileage when they're still blank.
  const pickService = (id: string) => {
    const service = services.find((s) => String(s.id) === id);
    setValues({ ...values, serviceId: id,
      installedDate: service && (!values.installedDate || values.installedDate === today) ? service.date : values.installedDate,
      installedMiles: service?.miles != null && !values.installedMiles ? String(service.miles) : values.installedMiles });
  };
  const text = (key: keyof TireFormInitial, label: string, extra: { help?: string; inputMode?: "numeric"; type?: string; max?: number } = {}) =>
    <label className="field" htmlFor={`tire-${key}`}><span>{label}</span>
      <input className="input" id={`tire-${key}`} name={key} type={extra.type ?? "text"} value={values[key] as string} inputMode={extra.inputMode}
        maxLength={extra.max} max={extra.type === "date" ? today : undefined} aria-invalid={Boolean(errors[key])} onChange={(e) => set(key, e.target.value)} />
      {extra.help && <small>{extra.help}</small>}
      {errors[key] && <small className="field-error">{errors[key]}</small>}
    </label>;
  return <form className="form" action={action} aria-busy={pending}>
    {adding && <input type="hidden" name="adding" value="1" />}
    <input type="hidden" name="requestKey" value={requestKey} />
    {state.message && <p className="notice notice--error" role="alert">{state.message}</p>}
    <fieldset className="fieldset" disabled={pending}>
      {adding ? <div className="field" id="tire-positions"><span>Where they went on</span>
        <div className="tire-positions">{TIRE_SPOTS.map((spot) => <label className="maintenance-checkbox" key={spot.key}>
          <input type="checkbox" name="positions" value={spot.key} checked={values.positions.includes(spot.key)}
            onChange={(e) => set("positions", e.target.checked ? [...values.positions, spot.key] : values.positions.filter((p) => p !== spot.key))} />
          <span>{spot.label}</span>
        </label>)}</div>
        <small>The tire there now comes off on the install date. Positions are where they went on; rotations move them later.</small>
        {errors.positions && <small className="field-error">{errors.positions}</small>}
      </div> : <label className="field" htmlFor="tire-position"><span>Where it went on</span>
        <select className="input" id="tire-position" name="position" value={values.positions[0] ?? ""} onChange={(e) => set("positions", e.target.value ? [e.target.value] : [])}>
          <option value="">Not recorded</option>
          {TIRE_SPOTS.map((spot) => <option key={spot.key} value={spot.key}>{spot.label}</option>)}
        </select>
      </label>}
      <label className="field" htmlFor="tire-serviceId"><span>Service record (optional)</span>
        <select className="input" id="tire-serviceId" name="serviceId" value={values.serviceId} aria-invalid={Boolean(errors.serviceId)} onChange={(e) => pickService(e.target.value)}>
          <option value="">None</option>
          {services.map((s) => <option key={s.id} value={s.id}>{serviceDay(s.date)}: {s.title}</option>)}
        </select>
        <small>The receipt for buying or fitting them. Its cost stays on the service record.</small>
        {errors.serviceId && <small className="field-error">{errors.serviceId}</small>}
      </label>
      {text("brand", "Brand (optional)", { max: 80 })}
      {text("model", "Model (optional)", { max: 80 })}
      {text("size", "Size (optional)", { max: 40, help: "From the sidewall, such as 225/65R17 102H." })}
      {text("dot", "DOT date code (optional)", { max: 40, help: "The last four digits after DOT on the sidewall: 2324 means week 23 of 2024. It sets the tire's age." })}
      {text("installedDate", "Date installed", { type: "date" })}
      {text("installedMiles", "Odometer when installed (optional)", { inputMode: "numeric" })}
      {!adding && text("removedDate", "Date removed (optional)", { type: "date", help: "Leave blank while it's still on the car." })}
      {!adding && text("removedMiles", "Odometer when removed (optional)", { inputMode: "numeric" })}
      <label className="field" htmlFor="tire-notes"><span>Notes (optional)</span>
        <textarea className="input" id="tire-notes" name="notes" rows={3} maxLength={2000} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
        {errors.notes && <small className="field-error">{errors.notes}</small>}
      </label>
    </fieldset>
    <div className="form-actions">
      <button className="button button--wide" type="submit" disabled={pending}>{pending ? "Saving..." : adding ? "Save tires" : "Save tire"}</button>
      <Link className="button button--quiet" href={`/cars/${carId}/tires`}>Cancel</Link>
    </div>
  </form>;
}

export function DeleteTire({ carId, tireId, revision }: { carId: number; tireId: number; revision: number }) {
  const [state, action, pending] = useActionState(deleteTireAction.bind(null, carId, tireId, revision), {} as TireFormState);
  return <form action={action} onSubmit={(event) => { if (!confirm("Delete this tire from the history? This cannot be undone.")) event.preventDefault(); }}>
    {state.message && <p className="field-error" role="alert">{state.message}</p>}
    <button type="submit" className="link-button link-button--danger" disabled={pending}>{pending ? "Deleting..." : "Delete tire"}</button>
  </form>;
}

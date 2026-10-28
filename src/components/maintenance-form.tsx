"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveMaintenanceAction } from "@/app/maintenance-actions";
import { maintenanceAttempt } from "@/lib/maintenance-client";
import { maintenanceDay, type MaintenanceFormInitial, type MaintenanceFormState } from "@/lib/maintenance-input";
import { formatMiles } from "@/lib/format";
import "@/app/maintenance.css";

export type MaintenanceServiceOption = { id: number; title: string; date: string; miles: number | null };

export function MaintenanceForm({ carId, maintenanceId, carName, today, initial, services }: {
  carId: number; maintenanceId: number | null; carName: string; today: string;
  initial: MaintenanceFormInitial; services: MaintenanceServiceOption[];
}) {
  const [state, action, pending] = useActionState((previous: MaintenanceFormState, form: FormData) =>
    maintenanceAttempt(() => saveMaintenanceAction(carId, maintenanceId, previous, form)), {} as MaintenanceFormState);
  const [values, setValues] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const summary = useRef<HTMLDivElement>(null);
  const errors = Object.fromEntries(Object.entries(state.errors ?? {}).filter(([key]) => !edited.has(key)));
  const showMessage = state.message && (!state.errors || Object.keys(errors).length > 0);
  const linked = values.lastServiceId !== "";
  const selected = services.find((service) => String(service.id) === values.lastServiceId);
  useEffect(() => { if (state.message) summary.current?.focus(); }, [state]);
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);
  const change = (key: keyof MaintenanceFormInitial, value: string | boolean) => {
    setDirty(true); setEdited((previous) => new Set([...previous, key, ...(key === "lastServiceId" ? ["baselineDate", "baselineMiles"] : [])]));
    setValues((previous) => ({ ...previous, [key]: value }));
  };
  const errorFor = (key: string) => errors[key] ? <small className="field-error" id={`${key}-error`}>{errors[key]}</small> : null;
  const describedBy = (key: string, help?: string) => [help, errors[key] ? `${key}-error` : undefined].filter(Boolean).join(" ") || undefined;
  const path = `/cars/${carId}/maintenance`;
  const fields = [
    { key: "title", label: "Maintenance name (required)", maxLength: 160, required: true },
    { key: "intervalMiles", label: "Repeat every (miles, optional)", help: "Whole miles. Leave blank for a date-only schedule.", numeric: true },
    { key: "intervalMonths", label: "Repeat every (months, optional)", help: "Whole calendar months. Month-end dates use the last day of the due month.", numeric: true },
  ] as const;
  return <form className="form maintenance-form" action={action} noValidate aria-busy={pending} onSubmit={() => setEdited(new Set())}>
    <input type="hidden" name="requestKey" value={initial.requestKey} />
    <input type="hidden" name="revision" value={initial.revision ?? ""} />
    {showMessage && <div className="notice notice--error" ref={summary} tabIndex={-1} role="alert">
      <p>{state.message}</p>
      {Object.keys(errors).length > 0 && <ul>{Object.entries(errors).map(([key, error]) => <li key={key}>
        <a href={`#${key}`} onClick={(event) => { event.preventDefault(); document.getElementById(key)?.focus(); }}>{error}</a>
      </li>)}</ul>}
      {state.stale && <Link className="maintenance-text-link" target="_blank" rel="noreferrer" href={maintenanceId === null ? path : `${path}/${maintenanceId}`}>Open latest schedule in a new tab</Link>}
    </div>}
    <p className="lede">For {carName}. Enter a mile interval, a month interval, or both. The first known limit reached makes maintenance due.</p>
    <fieldset className="fieldset" disabled={pending}>
      <legend className="sr-only">Schedule</legend>
      {fields.map((field) => <label className="field" htmlFor={field.key} key={field.key}><span>{field.label}</span>
        <input className="input" id={field.key} name={field.key} value={values[field.key]} type="text"
          inputMode={"numeric" in field ? "numeric" : undefined} required={"required" in field && field.required}
          maxLength={"maxLength" in field ? field.maxLength : 10}
          aria-invalid={Boolean(errors[field.key])} aria-describedby={describedBy(field.key, "help" in field ? `${field.key}-help` : undefined)}
          onChange={(event) => change(field.key, event.target.value)} />
        {"help" in field && <small id={`${field.key}-help`}>{field.help}</small>}{errorFor(field.key)}
      </label>)}
    </fieldset>
    <fieldset className="fieldset maintenance-baseline" disabled={pending}>
      <legend>Last completed or starting point</legend>
      <p className="lede">A baseline starts the interval. Leave unknown values blank. A baseline does not add a service or an odometer reading.</p>
      <label className="field" htmlFor="lastServiceId"><span>Completed service (optional)</span>
        <select className="input" id="lastServiceId" name="lastServiceId" value={values.lastServiceId}
          aria-invalid={Boolean(errors.lastServiceId)} aria-describedby={describedBy("lastServiceId", "lastServiceId-help")}
          onChange={(event) => change("lastServiceId", event.target.value)}>
          <option value="">Use manual baseline</option>
          {linked && !selected && <option value={values.lastServiceId}>Linked service is unavailable. Choose another baseline.</option>}
          {services.map((service) => <option key={service.id} value={service.id}>{maintenanceDay(service.date)}: {service.title}{service.miles === null ? " (mileage unknown)" : ` (${formatMiles(service.miles)} miles)`}</option>)}
        </select>
        <small id="lastServiceId-help">Only completed work for this car. Saving a link clears the manual baseline. Later service corrections update the due result; deleting the service requires a new baseline.</small>
        {errorFor("lastServiceId")}
      </label>
      {linked ? <p className="maintenance-baseline-preview" role="status">{selected ? `Using ${maintenanceDay(selected.date)}; ${selected.miles === null ? "service mileage is unknown" : `${formatMiles(selected.miles)} miles`}.` : "The linked service is unavailable. Choose completed service or use a manual baseline."}</p> : <>
        <label className="field" htmlFor="baselineDate"><span>Manual baseline date (optional)</span>
          <input className="input" id="baselineDate" name="baselineDate" type="date" value={values.baselineDate} max={today}
            aria-invalid={Boolean(errors.baselineDate)} aria-describedby={describedBy("baselineDate", "baselineDate-help")}
            onChange={(event) => change("baselineDate", event.target.value)} />
          <small id="baselineDate-help">The last completion date or a starting date you choose, up to today.</small>{errorFor("baselineDate")}
        </label>
        <label className="field" htmlFor="baselineMiles"><span>Manual baseline mileage (optional)</span>
          <input className="input" id="baselineMiles" name="baselineMiles" inputMode="numeric" value={values.baselineMiles}
            aria-invalid={Boolean(errors.baselineMiles)} aria-describedby={describedBy("baselineMiles", "baselineMiles-help")}
            onChange={(event) => change("baselineMiles", event.target.value)} />
          <small id="baselineMiles-help">Leave blank if unknown. Zero means an actual 0-mile baseline.</small>{errorFor("baselineMiles")}
        </label>
      </>}
    </fieldset>
    <label className="maintenance-checkbox" htmlFor="enabled">
      <input id="enabled" name="enabled" type="checkbox" checked={values.enabled} disabled={pending}
        aria-describedby="enabled-help" onChange={(event) => change("enabled", event.target.checked)} />
      <span>Enabled <small id="enabled-help">Include this schedule in due lists. Uncheck to keep it without reminders.</small></span>
    </label>
    <label className="maintenance-checkbox" htmlFor="optional">
      <input id="optional" name="optional" type="checkbox" checked={values.optional} disabled={pending}
        aria-describedby="optional-help" onChange={(event) => change("optional", event.target.checked)} />
      <span>Optional <small id="optional-help">The owner&apos;s manual doesn&apos;t call for it. It stays in the plan as a reminder, but never counts as overdue or sends a notification.</small></span>
    </label>
    <label className="maintenance-checkbox" htmlFor="asksTread">
      <input id="asksTread" name="asksTread" type="checkbox" checked={values.asksTread} disabled={pending}
        aria-describedby="asksTread-help" onChange={(event) => change("asksTread", event.target.checked)} />
      <span>Ask for tread depth <small id="asksTread-help">Mark done asks for all four tread depths, for a tread check or a rotation. They feed the tire wear estimate.</small></span>
    </label>
    <label className="field" htmlFor="notes"><span>Notes (optional)</span>
      <textarea className="input" name="notes" id="notes" rows={4} maxLength={5000} value={values.notes} disabled={pending}
        aria-invalid={Boolean(errors.notes)} aria-describedby={describedBy("notes")} onChange={(event) => change("notes", event.target.value)} />{errorFor("notes")}
    </label>
    <div className="form-actions">
      <button className="button button--wide" disabled={pending} type="submit">{pending ? "Saving..." : "Save schedule"}</button>
      <Link className="button button--quiet" href={maintenanceId === null ? path : `${path}/${maintenanceId}`}
        onClick={(event) => { if (dirty && !confirm("Discard your unsaved changes?")) event.preventDefault(); }}>Cancel</Link>
    </div>
  </form>;
}

"use client";

import Link from "next/link";
import { Fragment, useActionState, useEffect, useRef, useState } from "react";
import { saveServiceAction } from "@/app/service-actions";
import { categoryInfo, guessCategory, SERVICE_CATEGORIES, type ServiceCategory } from "@/lib/cost-categories";
import { MAX_LINE_ITEMS, type ServiceFormState } from "@/lib/service-input";
import { CategoryIcon } from "./category-icon";
import { treadValues, type TreadKey } from "@/lib/tire-input";
import { TreadFields } from "./tread-fields";
import "@/app/maintenance.css";
import "@/app/reports.css";

export type ServiceFormInitial = {
  kind: "service" | "quote"; title: string; date: string; shop: string; miles: string;
  /** Blank on a new record: the kind is guessed from the title until someone picks one. */
  category: ServiceCategory | "";
  totalCents: string; notes: string; requestKey: string; revision?: number;
  lineItems: { description: string; cost: string }[];
  /** The four tread boxes; blank when no reading was taken. */
  tread?: Record<TreadKey, string>;
};

/** A maintenance schedule this new work could mark done. */
export type CompletableSchedule = { id: number; title: string; state: string };

export function ServiceForm({ carId, serviceId, carName, today, initial, completable = [] }: {
  carId: number; serviceId: number | null; carName: string; today: string; initial: ServiceFormInitial; completable?: CompletableSchedule[];
}) {
  const [state, action, pending] = useActionState(saveServiceAction.bind(null, carId, serviceId), {} as ServiceFormState);
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const sequence = useRef(initial.lineItems.length);
  const [items, setItems] = useState(initial.lineItems.map((item, key) => ({ ...item, key })));
  // Controlled so ticks survive a failed save (React resets uncontrolled form fields after every action).
  const [completes, setCompletes] = useState<Set<number>>(new Set());
  const [tread, setTread] = useState(initial.tread ?? treadValues(null));
  const [picked, setPicked] = useState<ServiceCategory | "">(initial.category);
  const category = picked || guessCategory(values.title);
  const summary = useRef<HTMLDivElement>(null);
  const errors = Object.fromEntries(Object.entries(state.errors ?? {}).filter(([key]) => !edited.has(key)));
  const showMessage = state.message && (!state.errors || Object.keys(errors).length > 0);
  const treadErrors = Object.keys(errors).some((key) => key.startsWith("tread."));
  useEffect(() => { if (state.message) summary.current?.focus(); }, [state]);
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);
  const change = (key: string) => { setDirty(true); setEdited((prev) => new Set([...prev, key])); };
  const changeItems = () => {
    setDirty(true);
    setEdited((prev) => new Set([...prev, ...Object.keys(state.errors ?? {}).filter((key) => /^item(?:Description|Cost)\d+$/.test(key) || key === "lineItems")]));
  };
  const errorFor = (key: string) => errors[key] ? <small className="field-error" id={`${key}-error`}>{errors[key]}</small> : null;
  const describedBy = (key: string, help?: string) => [help, errors[key] ? `${key}-error` : undefined].filter(Boolean).join(" ") || undefined;
  const fields = [
    { key: "title", label: values.kind === "quote" ? "Work quoted" : "Work performed", type: "text", max: 160, required: true },
    { key: "date", label: values.kind === "quote" ? "Quote date" : "Service date", type: "date", required: true },
    { key: "shop", label: "Shop or DIY (optional)", type: "text", max: 120 },
    { key: "miles", label: "Odometer in miles (optional)", type: "text", inputMode: "numeric" as const, help: "Leave blank if the mileage is unknown." },
    { key: "totalCents", label: values.kind === "quote" ? "Quoted total in dollars (optional)" : "Total paid in dollars (optional)", type: "text", inputMode: "decimal" as const, help: "Include tax. Leave blank if the total is unknown; use 0 for free work." },
  ] as const;
  return (
    <form action={action} className="form service-form" noValidate onSubmit={() => setEdited(new Set())} aria-busy={pending}>
      <input type="hidden" name="requestKey" value={initial.requestKey} />
      <input type="hidden" name="revision" value={initial.revision ?? ""} />
      {showMessage && <div ref={summary} tabIndex={-1} className="notice notice--error" role="alert">
        <p>{state.message}</p>
        {Object.keys(errors).length > 0 && <ul>{Object.entries(errors).map(([key, error]) => <li key={key}><a href={`#${key}`} onClick={(event) => { event.preventDefault(); document.getElementById(key)?.focus(); }}>{error}</a></li>)}</ul>}
      </div>}
      <p className="lede">For {carName}. Description and date are required. You can attach receipts after saving.</p>
      <fieldset className="fieldset" disabled={pending}>
        <label className="field" htmlFor="kind"><span>Record type</span>
          <select className="input" name="kind" id="kind" required value={values.kind} aria-invalid={Boolean(errors.kind)} aria-describedby={describedBy("kind", "kind-help")}
            onChange={(e) => { change("kind"); setValues({ ...values, kind: e.target.value as "service" | "quote" }); }}>
            <option value="service">Completed service</option><option value="quote">Quote</option>
          </select>
          <small id="kind-help">{values.kind === "quote" ? "Quotes stay separate from completed work and do not update mileage." : "Use the date, mileage and cost of the completed work."}</small>
          {errorFor("kind")}
        </label>
        {fields.map((field) => {
          const key = field.key;
          const help = "help" in field ? field.help : null;
          return <Fragment key={key}><label className="field" htmlFor={key}><span>{field.label}</span>
            <input className="input" id={key} name={key} type={field.type} value={values[key]}
              max={field.type === "date" ? today : undefined} maxLength={"max" in field ? field.max : undefined}
              required={"required" in field && field.required} inputMode={"inputMode" in field ? field.inputMode : undefined}
              aria-invalid={Boolean(errors[key])} aria-describedby={describedBy(key, help ? `${key}-help` : undefined)}
              onChange={(e) => { change(key); setValues({ ...values, [key]: e.target.value }); }} />
            {help && <small id={`${key}-help`}>{help}</small>}{errorFor(key)}
          </label>
          {/* The kind follows the description, so it sits right under it. */}
          {key === "title" && <fieldset className="fieldset kind-pick" id="category" tabIndex={-1} aria-describedby={describedBy("category", "category-help")}>
            <legend>Kind of cost</legend>
            <div className="kind-pick-options">{SERVICE_CATEGORIES.map((option) => <label key={option} className={`cat-${option}`}>
              <input type="radio" name="category" value={option} checked={category === option}
                onChange={() => { change("category"); setPicked(option); }} />
              <CategoryIcon category={option} />{categoryInfo[option].label}
            </label>)}</div>
            <small id="category-help">{picked ? categoryInfo[category].hint : "Guessed from the description. Tap another to change it."}</small>
            {errorFor("category")}
          </fieldset>}</Fragment>;
        })}
      </fieldset>
      <fieldset className="fieldset service-items" disabled={pending}>
        <legend>Line items (optional)</legend>
        <p className="lede">Parts, labor, or other work listed on the receipt. Amounts can stay blank.</p>
        {items.map((item, index) => <div className="service-item" key={item.key}>
          <label className="field" htmlFor={`itemDescription${index}`}><span>Item {index + 1}</span>
            <input className="input" name="itemDescription" id={`itemDescription${index}`} maxLength={200} value={item.description}
              aria-invalid={Boolean(errors[`itemDescription${index}`])} aria-describedby={describedBy(`itemDescription${index}`)}
              onChange={(e) => { change(`itemDescription${index}`); setItems(items.map((v) => v.key === item.key ? { ...v, description: e.target.value } : v)); }} />
            {errorFor(`itemDescription${index}`)}
          </label>
          <div className="service-item-amount">
            <label className="field" htmlFor={`itemCost${index}`}><span>Amount in dollars (optional)</span>
              <input className="input" name="itemCost" id={`itemCost${index}`} inputMode="decimal" value={item.cost}
                aria-invalid={Boolean(errors[`itemCost${index}`])} aria-describedby={describedBy(`itemCost${index}`)}
                onChange={(e) => { change(`itemCost${index}`); setItems(items.map((v) => v.key === item.key ? { ...v, cost: e.target.value } : v)); }} />
              {errorFor(`itemCost${index}`)}
            </label>
            {items.length > 1 && <button className="link-button link-button--danger" type="button" aria-label={`Remove item ${index + 1}`}
              onClick={() => { changeItems(); setItems(items.filter((v) => v.key !== item.key)); }}>Remove</button>}
          </div>
        </div>)}
        {items.length < MAX_LINE_ITEMS && <button type="button" className="button button--quiet" onClick={() => { changeItems(); setItems([...items, { key: sequence.current++, description: "", cost: "" }]); }}>Add line item</button>}
      </fieldset>
      {serviceId === null && values.kind === "service" && completable.length > 0 && <fieldset className="fieldset" id="completes" tabIndex={-1} disabled={pending}>
        <legend>This work completes (optional)</legend>
        <p className="lede">Tick the maintenance this covers. Each ticked schedule restarts from this record and its reminders stop.</p>
        {errorFor("completes")}
        {completable.map((schedule) => <label className="maintenance-checkbox" htmlFor={`completes-${schedule.id}`} key={schedule.id}>
          <input type="checkbox" id={`completes-${schedule.id}`} name="completes" value={schedule.id} checked={completes.has(schedule.id)}
            onChange={(e) => { change("completes"); setCompletes((previous) => { const next = new Set(previous); if (e.target.checked) next.add(schedule.id); else next.delete(schedule.id); return next; }); }} />
          <span>{schedule.title} <small>{schedule.state}</small></span>
        </label>)}
      </fieldset>}
      {values.kind === "service" && <details className="disclosure tread-disclosure" open={treadErrors || Object.values(initial.tread ?? {}).some(Boolean) || undefined}>
        <summary>Tread depth (optional)</summary>
        <TreadFields values={tread} errors={errors} disabled={pending} legend="Tread depth at this service"
          onChange={(key, value) => { change(`tread.${key}`); setTread({ ...tread, [key]: value }); }} />
      </details>}
      <label className="field" htmlFor="notes"><span>Notes (optional)</span>
        <textarea className="input" id="notes" name="notes" rows={4} maxLength={5000} value={values.notes} disabled={pending}
          aria-invalid={Boolean(errors.notes)} aria-describedby={describedBy("notes")}
          onChange={(e) => { change("notes"); setValues({ ...values, notes: e.target.value }); }} />{errorFor("notes")}
      </label>
      <div className="form-actions">
        <button className="button button--wide" type="submit" disabled={pending}>{pending ? "Saving..." : values.kind === "quote" ? "Save quote" : "Save service"}</button>
        <Link className="button button--quiet" href={serviceId === null ? `/cars/${carId}/services` : `/cars/${carId}/services/${serviceId}`}
          onClick={(event) => { if (dirty && !confirm("Discard your unsaved changes?")) event.preventDefault(); }}>Cancel</Link>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { saveFuelAction } from "@/app/fuel-actions";
import { carTone } from "@/lib/car-tone";
import type { FuelFormState } from "@/lib/fuel-input";
import "@/app/fuel.css";

export type FuelFormInitial = { date: string; miles: string; gallonsMilli: string; totalCents: string; fullTank: boolean; missedFillups: boolean; notes: string; requestKey: string; revision?: number };
export type FuelCar = { id: number; nickname: string; hint?: string };
const CAR_STORAGE = "household-garage:fuel-car";
const rememberedCar = () => { try { return localStorage.getItem(CAR_STORAGE) ?? ""; } catch { return ""; } };
const subscribeCar = (notify: () => void) => { window.addEventListener("storage", notify); return () => window.removeEventListener("storage", notify); };
function rememberCar(value: string) { try { localStorage.setItem(CAR_STORAGE, value); } catch { /* Selection still works when browser storage is unavailable. */ } }
const CloseIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;
type NumberKey = "miles" | "gallonsMilli" | "totalCents";

/** Fill-up entry, built for the pump: the car as a switch, three big number fields, then save. */
export function FuelForm({ cars, carId, fuelId = null, today, initial, title, intro }: {
  cars: FuelCar[]; carId?: number; fuelId?: number | null; today: string; initial: FuelFormInitial; title: string; intro?: string;
}) {
  const [state, action, pending] = useActionState(async (previous: FuelFormState, form: FormData) => {
    try { return await saveFuelAction(carId ?? null, fuelId, previous, form); }
    catch (error) {
      if (error && typeof error === "object" && "digest" in error && typeof error.digest === "string" && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(error.digest)) throw error;
      return { message: "The save could not be confirmed. Your entries are still here. Try again with the same values to avoid a duplicate." };
    }
  }, {} as FuelFormState);
  const [values, setValues] = useState(initial);
  const storedCar = useSyncExternalStore(subscribeCar, rememberedCar, () => "");
  const [chosenCar, setChosenCar] = useState<string | null>(null);
  const selected = String(carId ?? chosenCar ?? (cars.some((car) => String(car.id) === storedCar) ? storedCar : cars[0]?.id ?? ""));
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const errors = Object.fromEntries(Object.entries(state.errors ?? {}).filter(([key]) => !edited.has(key)));
  useEffect(() => { if (state.message) summary.current?.focus(); }, [state]);
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);
  const change = (key: string) => { setDirty(true); setChosenCar(selected); setEdited((previous) => new Set([...previous, key])); };
  const describedBy = (key: string) => [`${key}-help`, errors[key] ? `${key}-error` : ""].filter(Boolean).join(" ");
  const errorFor = (key: string) => errors[key] ? <small className="field-error" id={`${key}-error`}>{errors[key]}</small> : null;
  const cancel = fuelId === null ? selected ? `/cars/${selected}/fuel` : "/" : `/cars/${selected}/fuel/${fuelId}`;
  const current = cars.find((car) => String(car.id) === selected);
  const number = (key: NumberKey, label: string, mode: "numeric" | "decimal", unit: string, placeholder: string, help: string, visibleHelp = false) =>
    <label className="big-field" htmlFor={key}><span>{label}</span>
      <span className="big-field-entry">
        {unit === "$" && <span className="big-field-unit" aria-hidden="true">$</span>}
        <input className="input" id={key} name={key} type="text" inputMode={mode} autoComplete="off" required placeholder={placeholder}
          value={values[key]} aria-invalid={Boolean(errors[key])} aria-describedby={describedBy(key)}
          onChange={(event) => { change(key); setValues({ ...values, [key]: event.target.value }); }} />
        {unit !== "$" && <span className="big-field-unit" aria-hidden="true">{unit}</span>}
      </span>
      <small id={`${key}-help`} className={visibleHelp ? undefined : "sr-only"}>{help}</small>{errorFor(key)}
    </label>;
  const toggle = (key: "fullTank" | "missedFillups", label: string, help: string) =>
    <label className="setting-row" htmlFor={key}>
      <span><strong>{label}</strong><small id={`${key}-help`}>{help}</small>{errorFor(key)}</span>
      <input className="switch" type="checkbox" role="switch" id={key} name={key} checked={values[key]}
        aria-describedby={describedBy(key)} aria-invalid={Boolean(errors[key])}
        onChange={(event) => { change(key); setValues({ ...values, [key]: event.target.checked }); }} />
    </label>;
  return <form className="form fuel-form" action={action} noValidate aria-busy={pending} onSubmit={() => { setEdited(new Set()); rememberCar(selected); }}>
    <div className="fill-head">
      <h1 className="page-title">{title}</h1>
      <Link className="fill-close" href={cancel} aria-label="Cancel" onClick={(event) => { if (dirty && !confirm("Discard your unsaved changes?")) event.preventDefault(); }}><CloseIcon /></Link>
    </div>
    {intro && <p className="lede">{intro}</p>}
    <input type="hidden" name="requestKey" value={initial.requestKey} />
    <input type="hidden" name="revision" value={initial.revision ?? ""} />
    {state.message && (!state.errors || Object.keys(errors).length > 0) && <div ref={summary} tabIndex={-1} className="notice notice--error" role="alert">
      <p>{state.message}</p>
      {state.message.includes("no longer in the garage") && <Link href="/">Return to garage</Link>}
      {state.message.includes("sign-in expired") && <a href="/sign-in" target="_blank" rel="noreferrer">Sign in in another tab</a>}
      {fuelId !== null && <a href={`/cars/${selected}/fuel/${fuelId}`} target="_blank" rel="noreferrer">Open the latest record in another tab</a>}
      {Object.keys(errors).length > 0 && <ul>{Object.entries(errors).map(([key, message]) => <li key={key}><a href={`#${key}`} onClick={(event) => { event.preventDefault(); document.getElementById(key)?.focus(); }}>{message}</a></li>)}</ul>}
    </div>}
    <fieldset className="fieldset" disabled={pending}>
      <legend className="sr-only">Car, odometer, gallons, total and date are required.</legend>
      {carId !== undefined ? <input type="hidden" name="carId" value={carId} /> : cars.length <= 4 ? <fieldset className="car-pick" aria-describedby={describedBy("carId")}>
        <legend className="sr-only">Car</legend>
        {cars.map((car, index) => <label key={car.id} className={carTone(car.id)}>
          <input type="radio" name="carId" id={index === 0 ? "carId" : `carId-${car.id}`} value={car.id} checked={selected === String(car.id)}
            onChange={() => { change("carId"); setChosenCar(String(car.id)); rememberCar(String(car.id)); }} />
          <span>{car.nickname}</span>
        </label>)}
        <small id="carId-help" className="sr-only">Your choice is remembered on this device.</small>{errorFor("carId")}
      </fieldset> : <label className="field" htmlFor="carId"><span>Car</span>
        <select className="input" id="carId" name="carId" required value={selected} aria-invalid={Boolean(errors.carId)} aria-describedby={describedBy("carId")}
          onChange={(event) => { change("carId"); setChosenCar(event.target.value); rememberCar(event.target.value); }}>
          {cars.map((car) => <option key={car.id} value={car.id}>{car.nickname}</option>)}
        </select><small id="carId-help">Your choice is remembered on this device.</small>{errorFor("carId")}
      </label>}
      {number("miles", "Odometer", "numeric", "mi", "0", current?.hint ?? "The whole-mile reading on the dashboard.", Boolean(current?.hint))}
      <div className="big-pair">
        {number("gallonsMilli", "Gallons", "decimal", "gal", "0.000", "US gallons from the pump, up to 3 decimal places.")}
        {number("totalCents", "Total paid", "decimal", "$", "0.00", "The total charge in dollars. Use 0 for free fuel.")}
      </div>
      {toggle("fullTank", "Filled to full", "Switch off for a partial fill. MPG counts between full tanks.")}
      <label className="date-row" htmlFor="date"><span>Date</span>
        <input className="input" type="date" id="date" name="date" required max={today} value={values.date} aria-invalid={Boolean(errors.date)} aria-describedby={describedBy("date")}
          onChange={(event) => { change("date"); setValues({ ...values, date: event.target.value }); }} />
      </label>
      <small id="date-help" className="sr-only">Use the date of this fill-up.</small>{errorFor("date")}
      <details className="fill-more" open={values.missedFillups || Boolean(values.notes) || Boolean(errors.missedFillups || errors.notes) || undefined}>
        <summary>Missed a fill-up, or add a note</summary>
        <div className="fill-more-body">
          {toggle("missedFillups", "I missed logging a fill-up", "Fills are missing since the last entry. MPG restarts at the next full tank.")}
          <label className="field" htmlFor="notes"><span>Notes (optional)</span>
            <textarea className="input" id="notes" name="notes" rows={3} maxLength={5000} value={values.notes} aria-invalid={Boolean(errors.notes)} aria-describedby={errors.notes ? "notes-error" : undefined}
              onChange={(event) => { change("notes"); setValues({ ...values, notes: event.target.value }); }} />{errorFor("notes")}
          </label>
        </div>
      </details>
    </fieldset>
    <div className="form-actions">
      <button type="submit" className="button button--wide" disabled={pending}>{pending ? "Saving..." : fuelId === null ? "Save fill-up" : "Save changes"}</button>
    </div>
  </form>;
}

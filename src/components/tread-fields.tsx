"use client";

import { REPLACE_AT_32NDS, TREAD_SPOTS, type TreadKey } from "@/lib/tire-input";
import "@/app/tires.css";

/**
 * The four tread depths, laid out like the car seen from above: fronts on top. Controlled, so entries
 * survive a failed save.
 */
export function TreadFields({ values, onChange, errors = {}, disabled, legend = "Tread depth (optional)" }: {
  values: Record<TreadKey, string>; onChange: (key: TreadKey, value: string) => void;
  errors?: Record<string, string>; disabled?: boolean; legend?: string;
}) {
  const problems = TREAD_SPOTS.map((spot) => errors[`tread.${spot.key}`]).filter(Boolean);
  return <fieldset className="fieldset tread-fields" disabled={disabled}>
    <legend>{legend}</legend>
    <p className="lede">In 32nds of an inch, as the gauge or shop report reads: type 9 for 9/32. Replace at {REPLACE_AT_32NDS}/32.</p>
    <div className="tread-grid">
      {TREAD_SPOTS.map((spot) => <label className="field" htmlFor={`tread-${spot.key}`} key={spot.key}><span>{spot.label}</span>
        <span className="tread-input"><input className="input" id={`tread-${spot.key}`} name={`tread.${spot.key}`} inputMode="numeric" maxLength={5}
          value={values[spot.key]} aria-invalid={Boolean(errors[`tread.${spot.key}`])} onChange={(e) => onChange(spot.key, e.target.value)} />
          <small>/32</small></span>
      </label>)}
    </div>
    {problems.map((problem) => <small className="field-error" key={problem}>{problem}</small>)}
  </fieldset>;
}

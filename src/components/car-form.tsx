"use client";

import { useActionState } from "react";
import { saveCarAction, type FormState } from "@/app/car-actions";

export type CarFormValues = Record<
  "nickname" | "year" | "make" | "model" | "trim" | "engine" | "color" | "plate" | "vin" | "notes",
  string
>;

const blank: CarFormValues = {
  nickname: "",
  year: "",
  make: "",
  model: "",
  trim: "",
  engine: "",
  color: "",
  plate: "",
  vin: "",
  notes: "",
};

const noFix = { autoCorrect: "off", autoCapitalize: "characters", spellCheck: false } as const;

export function CarForm({ carId, initial }: { carId: number | null; initial?: CarFormValues }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveCarAction.bind(null, carId),
    {},
  );
  const value = (key: keyof CarFormValues | "odometer") =>
    state.values?.[key] ?? (key === "odometer" ? "" : (initial ?? blank)[key]);
  const isNew = carId === null;

  return (
    <form action={action} className="form">
      {state.message && (
        <p className="notice notice--error" role="alert">
          {state.message}
        </p>
      )}

      <label className="field">
        <span>Nickname</span>
        <input className="input" name="nickname" defaultValue={value("nickname")} required maxLength={40} />
      </label>

      <label className="field">
        <span>VIN</span>
        <input className="input mono" name="vin" defaultValue={value("vin")} maxLength={20} {...noFix} />
        <small>
          17 characters, on the driver&rsquo;s side of the dashboard or the door jamb.
          {isNew ? " The year, make and model are filled in from it." : " A new VIN fills in details you haven't changed."}
        </small>
      </label>

      {isNew && (
        <label className="field">
          <span>Odometer now</span>
          <input
            className="input"
            name="odometer"
            inputMode="numeric"
            pattern="[0-9,]*"
            autoComplete="off"
            defaultValue={value("odometer")}
            placeholder="47950"
          />
        </label>
      )}

      <fieldset className="fieldset">
        <legend>Details</legend>
        {isNew && <p className="lede">Leave these blank if you entered a VIN. You can fix anything later.</p>}
        <div className="pair">
          <label className="field">
            <span>Year</span>
            <input
              className="input"
              name="year"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoComplete="off"
              defaultValue={value("year")}
            />
          </label>
          <label className="field">
            <span>Make</span>
            <input className="input" name="make" defaultValue={value("make")} maxLength={40} />
          </label>
        </div>
        <div className="pair">
          <label className="field">
            <span>Model</span>
            <input className="input" name="model" defaultValue={value("model")} maxLength={60} />
          </label>
          <label className="field">
            <span>Trim</span>
            <input className="input" name="trim" defaultValue={value("trim")} maxLength={80} />
          </label>
        </div>
        <label className="field">
          <span>Engine</span>
          <input className="input" name="engine" defaultValue={value("engine")} maxLength={80} />
        </label>
        <div className="pair">
          <label className="field">
            <span>Color</span>
            <input className="input" name="color" defaultValue={value("color")} maxLength={40} />
          </label>
          <label className="field">
            <span>Plate</span>
            <input className="input mono" name="plate" defaultValue={value("plate")} maxLength={20} {...noFix} />
          </label>
        </div>
        <label className="field">
          <span>Notes</span>
          <textarea className="input" name="notes" defaultValue={value("notes")} maxLength={1000} />
        </label>
      </fieldset>

      <div className="form-actions">
        <button type="submit" className="button button--wide" disabled={pending}>
          {pending ? "Saving…" : isNew ? "Add car" : "Save"}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { addReadingAction, type FormState } from "@/app/car-actions";

export function ReadingForm({ carId, today }: { carId: number; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    addReadingAction.bind(null, carId),
    {},
  );
  return (
    <form action={action} className="form">
      {state.message && (
        <p className="notice notice--error" role="alert">
          {state.message}
        </p>
      )}
      <label className="field">
        <span>Odometer</span>
        <div className="unit-input">
          <input
            className="input input--big"
            name="miles"
            inputMode="numeric"
            pattern="[0-9,]*"
            autoComplete="off"
            required
            autoFocus
            defaultValue={state.values?.miles ?? ""}
          />
          <span>miles</span>
        </div>
      </label>
      <label className="field">
        <span>Read on</span>
        <input
          className="input"
          type="date"
          name="date"
          max={today}
          required
          defaultValue={state.values?.date ?? today}
        />
      </label>
      <button type="submit" className="button button--wide" disabled={pending}>
        {pending ? "Saving…" : "Save reading"}
      </button>
    </form>
  );
}

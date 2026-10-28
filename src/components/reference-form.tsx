"use client";

import { useActionState, useState } from "react";
import { saveReferenceAction, type FormState } from "@/app/car-actions";
import { MAX_EXTRA_LINES, REFERENCE_GROUPS, type QuickReference } from "@/lib/reference";

const noFix = { autoCorrect: "off", spellCheck: false } as const;

export function ReferenceForm({ carId, initial }: { carId: number; initial: QuickReference }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveReferenceAction.bind(null, carId),
    {},
  );
  // Controlled, so nothing typed is lost if a save is turned back.
  const [values, setValues] = useState<Record<string, string>>(initial.values);
  const [extra, setExtra] = useState(
    initial.extra.length ? initial.extra : [{ label: "", value: "" }],
  );
  const setExtraAt = (i: number, change: Partial<{ label: string; value: string }>) =>
    setExtra((lines) => lines.map((line, j) => (j === i ? { ...line, ...change } : line)));

  return (
    <form action={action} className="form">
      {state.message && (
        <p className="notice notice--error" role="alert">
          {state.message}
        </p>
      )}

      {REFERENCE_GROUPS.map((group) => (
        <fieldset className="fieldset panel" key={group.title}>
          <legend className="sr-only">{group.title}</legend>
          <h2 aria-hidden="true">{group.title}</h2>
          {group.fields
            .filter((field) => !field.unit)
            .map((field) => (
              <label className="field" key={field.key}>
                <span>{field.label}</span>
                <input
                  className="input"
                  name={`ref.${field.key}`}
                  autoComplete="off"
                  placeholder={field.hint}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  {...noFix}
                />
              </label>
            ))}
          {group.fields.some((field) => field.unit) && (
            <div className="numbers">
              {group.fields
                .filter((field) => field.unit)
                .map((field) => (
                  <label className="field" key={field.key}>
                    <span>{field.label}</span>
                    <div className="unit-input">
                      <input
                        className="input"
                        name={`ref.${field.key}`}
                        inputMode={field.unit === "psi" ? "numeric" : "decimal"}
                        pattern="[0-9.]*"
                        autoComplete="off"
                        placeholder={field.hint}
                        value={values[field.key] ?? ""}
                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                      />
                      <span>{field.unit}</span>
                    </div>
                  </label>
                ))}
            </div>
          )}
        </fieldset>
      ))}

      <fieldset className="fieldset panel">
        <legend className="sr-only">Other</legend>
        <h2 aria-hidden="true">Other</h2>
        <p className="lede">Anything else worth having at the counter, like lug nut torque or a key fob battery.</p>
        {extra.map((line, i) => (
          <div className="extra-line" key={i}>
            <label className="field">
              <span>Name</span>
              <input
                className="input"
                name="extraLabel"
                autoComplete="off"
                placeholder="Lug nut torque"
                value={line.label}
                onChange={(e) => setExtraAt(i, { label: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Value</span>
              <input
                className="input"
                name="extraValue"
                autoComplete="off"
                placeholder="76 lb-ft"
                value={line.value}
                onChange={(e) => setExtraAt(i, { value: e.target.value })}
                {...noFix}
              />
            </label>
            <button
              type="button"
              className="link-button link-button--danger remove-line"
              aria-label={`Remove ${line.label || "this line"}`}
              onClick={() => setExtra((lines) => lines.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        {extra.length < MAX_EXTRA_LINES && (
          <button
            type="button"
            className="button button--quiet button--wide"
            onClick={() => setExtra((lines) => [...lines, { label: "", value: "" }])}
          >
            Add a line
          </button>
        )}
      </fieldset>

      <div className="save-bar">
        <button type="submit" className="button button--wide" disabled={pending}>
          {pending ? "Saving…" : "Save card"}
        </button>
      </div>
    </form>
  );
}

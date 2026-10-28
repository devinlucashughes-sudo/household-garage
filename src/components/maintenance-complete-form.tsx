"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { completeMaintenanceAction } from "@/app/maintenance-actions";
import { formatFileSize } from "@/lib/format";
import { maintenanceAttempt } from "@/lib/maintenance-client";
import type { MaintenanceFormState } from "@/lib/maintenance-input";
import { MAX_RECEIPT_BYTES, MAX_RECEIPTS, RECEIPT_ACCEPT } from "@/lib/service-input";
import { treadValues, type TreadKey } from "@/lib/tire-input";
import { TreadFields } from "./tread-fields";
import "@/app/maintenance.css";

/** All photos and receipts together must fit in one save; the server allows a little more than this. */
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

/**
 * Mark a schedule done: the work, what you found, and its photos and receipts in one save. It adds a
 * completed service record with the files attached and restarts the schedule from it.
 */
export function MaintenanceCompleteForm({ carId, maintenanceId, revision, today, miles, milesHint, requestKey, asksTread = false }: {
  carId: number; maintenanceId: number; revision: number; today: string; miles: string; milesHint: string; requestKey: string; asksTread?: boolean;
}) {
  const [state, action, pending] = useActionState((previous: MaintenanceFormState, form: FormData) =>
    maintenanceAttempt(() => completeMaintenanceAction(carId, maintenanceId, revision, previous, form)), {} as MaintenanceFormState);
  const [values, setValues] = useState({ date: today, miles, shop: "", totalCents: "", notes: "" });
  const [tread, setTread] = useState(treadValues(null));
  // Files belong to the attempt they were picked for: a failed save clears the picker, so the list goes with it.
  const [picked, setPicked] = useState({ state, files: [] as { name: string; size: number }[] });
  const photos = useRef<HTMLInputElement>(null);
  const errors = state.errors ?? {};
  const chosen = picked.state === state ? picked.files : [];
  const lost = picked.state !== state && picked.files.length > 0 && Boolean(state.message);
  const total = chosen.reduce((sum, file) => sum + file.size, 0);
  const problem = chosen.length > MAX_RECEIPTS ? `Choose up to ${MAX_RECEIPTS} photos or receipts.`
    : chosen.some((file) => file.size > MAX_RECEIPT_BYTES) ? "Each photo or receipt must be 10 MB or smaller."
      : total > MAX_TOTAL_BYTES ? "These add up to more than 40 MB. Save fewer now and add the rest on the record afterward." : "";
  const pick = () => setPicked({ state, files: [...(photos.current?.files ?? [])].map(({ name, size }) => ({ name, size })) });
  const fields = [
    { key: "date", label: "Date done", type: "date", help: null },
    { key: "miles", label: "Odometer in miles", type: "text", inputMode: "numeric" as const, help: `${milesHint} Mileage-based reminders need it.` },
    { key: "shop", label: "Shop or DIY (optional)", type: "text", help: null },
    { key: "totalCents", label: "Total paid in dollars (optional)", type: "text", inputMode: "decimal" as const, help: "Leave blank if unknown; use 0 for free work." },
  ] as const;
  const photoError = problem || errors.photos || (lost ? "Choose your photos and receipts again before saving." : "");
  return <form className="form" action={action} aria-busy={pending}
    onSubmit={(event) => { if (problem) { event.preventDefault(); photos.current?.focus(); } }}>
    <input type="hidden" name="requestKey" value={requestKey} />
    {state.message && <p className="notice notice--error" role="alert">{state.message}</p>}
    {state.stale && <Link className="maintenance-text-link" href={`/cars/${carId}/maintenance/${maintenanceId}`}>Open the latest schedule</Link>}
    <fieldset className="fieldset" disabled={pending}>
      {fields.map((field) => <label className="field" htmlFor={`done-${field.key}`} key={field.key}><span>{field.label}</span>
        <input className="input" id={`done-${field.key}`} name={field.key} type={field.type} value={values[field.key]}
          max={field.type === "date" ? today : undefined} inputMode={"inputMode" in field ? field.inputMode : undefined}
          aria-invalid={Boolean(errors[field.key])} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} />
        {field.help && <small>{field.help}</small>}
        {errors[field.key] && <small className="field-error">{errors[field.key]}</small>}
      </label>)}
      {asksTread && <TreadFields values={tread} errors={errors} disabled={pending} legend="Tread depth"
        onChange={(key: TreadKey, value) => setTread({ ...tread, [key]: value })} />}
      <label className="field" htmlFor="done-notes"><span>What you found (optional)</span>
        <textarea className="input" id="done-notes" name="notes" rows={4} maxLength={5000} value={values.notes}
          placeholder={asksTread ? "Uneven wear, damage, what the shop recommended" : "Tread depth, leaks, worn parts, what the shop recommended"}
          aria-invalid={Boolean(errors.notes)} onChange={(e) => setValues({ ...values, notes: e.target.value })} />
        {errors.notes && <small className="field-error">{errors.notes}</small>}
      </label>
      <label className="field" htmlFor="done-photos"><span>Photos and receipts (optional)</span>
        <input ref={photos} className="input receipt-input" type="file" id="done-photos" name="photos" multiple accept={RECEIPT_ACCEPT}
          aria-invalid={Boolean(photoError)} aria-describedby="done-photos-help done-photos-status" onChange={pick} />
        <small id="done-photos-help">Take photos or choose files: PDF, JPEG, PNG, WebP or HEIC, up to 10 files and 10 MB each.</small>
        {chosen.length > 0 && <ul className="chosen-files">{chosen.map((file, index) => <li key={`${file.name}-${index}`}>
          <span>{file.name}</span><small>{formatFileSize(file.size)}</small></li>)}</ul>}
        <small id="done-photos-status" className={photoError ? "field-error" : "sr-only"} role="status">{photoError || ""}</small>
      </label>
    </fieldset>
    <button className="button button--wide" type="submit" disabled={pending}>{pending ? (chosen.length ? "Saving and uploading..." : "Saving...") : "Mark done"}</button>
    <p className="lede">This adds a completed service record with your notes and files, restarts the schedule from it and stops its reminders. You can add more to the record afterward.</p>
  </form>;
}

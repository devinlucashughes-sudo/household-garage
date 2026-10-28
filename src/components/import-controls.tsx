"use client";

import { useActionState, useEffect, useState } from "react";
import { createImportAccessAction, editImportAction, pasteImportAction, reviewImportAction, revokeImportAccessAction, uploadImportOriginalAction } from "@/app/import-actions";
import type { ImportState } from "@/lib/import-input";
import { MAX_LINE_ITEMS, moneyValue, RECEIPT_ACCEPT } from "@/lib/service-input";
import "@/app/imports.css";

function Feedback({ state }: { state: ImportState }) {
  return state.message ? <div role={state.success ? "status" : "alert"} className={state.success ? "import-notice" : "import-error"}><p>{state.message}</p>{state.signInRequired && <a className="import-row-link" href="/sign-in" target="_blank" rel="noreferrer">Sign in in another tab</a>}</div> : null;
}
function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
export function ImportPaste() {
  const [state, action, pending] = useActionState(pasteImportAction, {});
  const [text, setText] = useState("");
  useUnsaved(Boolean(text));
  return <form action={action} className="panel import-form" aria-busy={pending}>
    <h2>Paste desktop JSON</h2>
    <label htmlFor="import-json">Submission JSON</label>
    <p id="import-json-help" className="lede">Include type, carId, a unique requestId and data. Up to 128 KB. This creates a draft for review.</p>
    <textarea id="import-json" name="json" required value={text} disabled={pending} onChange={(e) => setText(e.target.value)} rows={12} spellCheck={false} aria-describedby="import-json-help" />
    <Feedback state={state} />
    <button className="button" disabled={pending}>{pending ? "Creating draft…" : "Create draft"}</button>
  </form>;
}
export function ImportAccessCreate() {
  const [state, action, pending] = useActionState(createImportAccessAction, {});
  const [secretHidden, setSecretHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  return <form action={action} className="panel import-form" onSubmit={() => { setSecretHidden(false); setCopied(false); }}>
    <h2>Create desktop access</h2>
    <label htmlFor="access-name">Desktop name</label>
    <input id="access-name" name="name" required maxLength={80} placeholder="For example, home desktop" />
    <Feedback state={state} />
    {state.secret && !secretHidden && <div className="import-secret">
      <label htmlFor="access-secret">Copy this credential now</label>
      <textarea id="access-secret" readOnly value={state.secret} rows={3} autoComplete="off" spellCheck={false} />
      <button type="button" className="button button--quiet" onClick={async () => { try { await navigator.clipboard.writeText(state.secret!); setCopied(true); } catch { setCopied(false); } }}>{copied ? "Copied" : "Copy credential"}</button>
      <button type="button" className="button button--quiet" onClick={() => setSecretHidden(true)}>Hide credential</button>
      <p className="lede">Store it privately. It can submit drafts and originals and list cars. Approval always requires sign-in.</p>
    </div>}
    <button className="button" disabled={pending}>{pending ? "Creating access…" : "Create desktop access"}</button>
  </form>;
}
export function ImportAccessRevoke({ id }: { id: string }) {
  const [state, action, pending] = useActionState(revokeImportAccessAction.bind(null, id), {});
  return <form action={action} className="import-form"><Feedback state={state} /><button className="button button--quiet" disabled={pending}>{pending ? "Revoking…" : "Revoke access"}</button></form>;
}
function correctionValues(payload: string) {
  const data = JSON.parse(payload);
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) if (key !== "lineItems") values[key] = value === null ? "" : String(value);
  if ("totalCents" in data) values.totalCents = moneyValue(data.totalCents);
  const items = (data.lineItems ?? []).map((item: { description: string; costCents: number | null }) => ({ description: item.description, cost: moneyValue(item.costCents) }));
  return { values, items: items as { description: string; cost: string }[] };
}
export function ImportReview({ id, carId, revision, payload, type, services = [] }: { id: string; carId: number; revision: number; payload: string; type: "service" | "maintenance"; services?: { id: number; title: string; date: string }[] }) {
  const initial = correctionValues(payload);
  const [values, setValues] = useState(initial.values);
  const [items, setItems] = useState(initial.items);
  const dirty = JSON.stringify({ values, items }) !== JSON.stringify(initial);
  useUnsaved(dirty);
  const [edit, editAction, editing] = useActionState(editImportAction.bind(null, id, carId, revision), {});
  const [approval, approveAction, approving] = useActionState(reviewImportAction.bind(null, id, carId, revision, "approve"), {});
  const [rejection, rejectAction, rejecting] = useActionState(reviewImportAction.bind(null, id, carId, revision, "reject"), {});
  const [upload, uploadAction, uploading] = useActionState(uploadImportOriginalAction.bind(null, id, carId, revision), {});
  const busy = editing || approving || rejecting || uploading;
  const change = (key: string, value: string) => setValues((previous) => ({ ...previous, [key]: value }));
  const field = (name: string, label: string, kind = "text", required = false, help?: string) => <div className="import-field" key={name}>
    <label htmlFor={`correction-${name}`}>{label}</label>
    {help && <p id={`help-${name}`} className="lede">{help}</p>}
    <input id={`correction-${name}`} name={name} type={kind} value={values[name] ?? ""} onChange={(e) => change(name, e.target.value)} required={required} disabled={busy}
      maxLength={name === "title" ? 160 : name === "shop" ? 120 : undefined}
      inputMode={["miles", "intervalMiles", "intervalMonths", "baselineMiles"].includes(name) ? "numeric" : name === "totalCents" ? "decimal" : undefined}
      aria-invalid={Boolean(edit.errors?.[name])} aria-describedby={[help ? `help-${name}` : "", edit.errors?.[name] ? `error-${name}` : ""].filter(Boolean).join(" ") || undefined} />
    {edit.errors?.[name] && <p className="import-error" id={`error-${name}`}>{edit.errors[name]}</p>}
  </div>;
  return <div className="import-sections">
    <form action={editAction} className="panel import-form" noValidate aria-busy={editing}>
      <h2>Correct draft details</h2>
      <input type="hidden" name="format" value="fields" />
      <p className="lede">Save corrections before approving. Leave unknown amounts blank; enter 0 for free work. Car and import type stay fixed.</p>
      {field("title", type === "service" ? "Work description (required)" : "Maintenance name (required)", "text", true)}
      {type === "service" ? <>
        <div className="import-field"><label htmlFor="correction-kind">Record kind</label><select id="correction-kind" name="kind" value={values.kind} onChange={(e) => change("kind", e.target.value)} disabled={busy}><option value="service">Completed service</option><option value="quote">Quote</option></select></div>
        {field("date", "Date (required)", "date", true)}
        {field("shop", "Shop (optional)")}
        {field("miles", "Odometer in miles (optional)")}
        {field("totalCents", "Total paid in dollars (optional)", "text", false, "For example, 75.99. Blank means unknown.")}
        <fieldset className="import-items"><legend>Line items (optional)</legend>
          <p className="lede">Line items describe the work. They are not added on top of the total paid.</p>
          {items.map((item, index) => <div className="import-line-item" key={index}>
            <label htmlFor={`item-description-${index}`}>Item {index + 1} description</label>
            <input id={`item-description-${index}`} name="itemDescription" value={item.description} maxLength={200} disabled={busy} onChange={(e) => setItems((previous) => previous.map((row, i) => i === index ? { ...row, description: e.target.value } : row))} aria-invalid={Boolean(edit.errors?.[`itemDescription${index}`])} aria-describedby={edit.errors?.[`itemDescription${index}`] ? `item-description-error-${index}` : undefined} />
            {edit.errors?.[`itemDescription${index}`] && <p id={`item-description-error-${index}`} className="import-error">{edit.errors[`itemDescription${index}`]}</p>}
            <label htmlFor={`item-cost-${index}`}>Item {index + 1} cost in dollars (optional)</label>
            <input id={`item-cost-${index}`} name="itemCost" value={item.cost} inputMode="decimal" disabled={busy} onChange={(e) => setItems((previous) => previous.map((row, i) => i === index ? { ...row, cost: e.target.value } : row))} aria-invalid={Boolean(edit.errors?.[`itemCost${index}`])} aria-describedby={edit.errors?.[`itemCost${index}`] ? `item-cost-error-${index}` : undefined} />
            {edit.errors?.[`itemCost${index}`] && <p id={`item-cost-error-${index}`} className="import-error">{edit.errors[`itemCost${index}`]}</p>}
            <button type="button" className="button button--quiet" disabled={busy} onClick={() => setItems((previous) => previous.filter((_, i) => i !== index))}>Remove item {index + 1}</button>
          </div>)}
          <button type="button" className="button button--quiet" disabled={items.length >= MAX_LINE_ITEMS || busy} onClick={() => setItems((previous) => [...previous, { description: "", cost: "" }])}>Add line item</button>
        </fieldset>
      </> : <>
        {field("intervalMiles", "Repeat every (miles, optional)", "text", false, "Provide a positive mile interval, a month interval, or both.")}
        {field("intervalMonths", "Repeat every (months, optional)")}
        <div className="import-field"><label htmlFor="correction-service">Last completed service (optional)</label><select id="correction-service" name="lastServiceId" value={values.lastServiceId} disabled={busy} onChange={(e) => change("lastServiceId", e.target.value)} aria-describedby="linked-service-help" aria-invalid={Boolean(edit.errors?.lastServiceId)}><option value="">Use a manual baseline</option>{values.lastServiceId && !services.some((service) => String(service.id) === values.lastServiceId) && <option value={values.lastServiceId}>Unavailable service (ID {values.lastServiceId}). Choose a completed service for this car.</option>}{services.map((service) => <option key={service.id} value={service.id}>{service.date} · {service.title}</option>)}</select><p id="linked-service-help" className="lede">Linked service supplies its current date and mileage. Unknown service mileage remains unknown.</p>{edit.errors?.lastServiceId && <p className="import-error">{edit.errors.lastServiceId}</p>}</div>
        {!values.lastServiceId && <>{field("baselineDate", "Manual baseline date (optional)", "date")}{field("baselineMiles", "Manual baseline miles (optional)", "text", false, "Use a known reading. Blank means unknown; 0 is a known baseline.")}</>}
        <label className="import-checkbox"><input type="checkbox" name="enabled" checked={values.enabled === "true"} disabled={busy} onChange={(e) => change("enabled", String(e.target.checked))} />Enabled</label>
      </>}
      <label htmlFor="correction-notes">Notes (optional)</label><textarea id="correction-notes" name="notes" value={values.notes ?? ""} disabled={busy} onChange={(e) => change("notes", e.target.value)} rows={4} maxLength={5000} aria-invalid={Boolean(edit.errors?.notes)} aria-describedby={edit.errors?.notes ? "notes-error" : undefined} />
      {edit.errors?.notes && <p className="import-error" id="notes-error">{edit.errors.notes}</p>}
      <p className="lede" role="status">{dirty ? "Unsaved corrections" : "Showing saved details"}</p>
      <Feedback state={edit} />
      <button className="button button--quiet" disabled={busy}>{editing ? "Saving…" : "Save corrections"}</button>
    </form>
    <form action={uploadAction} className="panel import-form">
      <h2>Add an original</h2>
      <label htmlFor="draft-original">Original file</label>
      <p id="original-help" className="lede">PDF, JPEG, PNG, WebP or HEIC. Up to 10 MB each and 10 originals per draft.</p>
      <input id="draft-original" type="file" name="original" accept={RECEIPT_ACCEPT} required aria-describedby="original-help" />
      <Feedback state={upload} />
      <button className="button button--quiet" disabled={busy || dirty}>{uploading ? "Saving original…" : "Save original"}</button>
    </form>
    <section className="panel import-form">
      <h2>Finish review</h2>
      <p>Approval adds the saved record to this car. Rejection keeps the draft and originals without adding a record.</p>
      {dirty && <p className="import-notice">Save your corrections before approving or rejecting.</p>}
      <Feedback state={approval} /><Feedback state={rejection} />
      <form action={approveAction}><button className="button button--wide" disabled={busy || dirty}>{approving ? "Approving…" : "Approve import"}</button></form>
      <form action={rejectAction}><button className="button button--quiet button--wide" disabled={busy || dirty}>{rejecting ? "Rejecting…" : "Reject import"}</button></form>
      <a href={`/imports/${id}`}>Open latest saved import</a>
      <p className="lede">Opening the latest import reloads this page. Keep any unsaved corrections before leaving.</p>
    </section>
  </div>;
}

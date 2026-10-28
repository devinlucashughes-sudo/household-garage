"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { deleteServiceAction, uploadReceiptAction } from "@/app/service-actions";
import { MAX_RECEIPT_BYTES, RECEIPT_ACCEPT, type ServiceFormState } from "@/lib/service-input";

export function ReceiptUpload({ carId, serviceId }: { carId: number; serviceId: number }) {
  const [state, action, pending] = useActionState(uploadReceiptAction.bind(null, carId, serviceId), {} as ServiceFormState);
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state.message === "Receipt saved." && input.current) input.current.value = ""; }, [state]);
  return <form action={action} className="form" aria-busy={pending} onSubmit={(event) => {
    const file = input.current?.files?.[0];
    if (!file || file.size > MAX_RECEIPT_BYTES) { event.preventDefault(); setProblem(!file ? "Choose a receipt first." : "Choose a receipt no larger than 10 MB."); input.current?.focus(); }
  }}>
    <label className="field" htmlFor="receipt"><span>Add a receipt or quote</span>
      <input ref={input} className="input receipt-input" type="file" id="receipt" name="receipt" accept={RECEIPT_ACCEPT} required disabled={pending}
        aria-invalid={Boolean(problem)} aria-describedby="receipt-help receipt-status" onChange={() => setProblem("")} />
      <small id="receipt-help">PDF, JPEG, PNG, WebP or HEIC. Up to 10 MB each; 10 files per record. Original files are kept with the record in backups.</small>
    </label>
    <p id="receipt-status" className={problem ? "field-error" : "lede"} role="status">{problem || state.message || ""}</p>
    <button className="button button--quiet button--wide" type="submit" disabled={pending}>{pending ? "Uploading..." : "Save receipt"}</button>
  </form>;
}

export function DeleteService({ carId, serviceId, revision, title }: { carId: number; serviceId: number; revision: number; title: string }) {
  const [state, action, pending] = useActionState(deleteServiceAction.bind(null, carId, serviceId, revision), {} as ServiceFormState);
  return <form action={action} onSubmit={(event) => { if (!confirm(`Delete "${title}" and its receipts? This cannot be undone.`)) event.preventDefault(); }}>
    {state.message && <p className="field-error" role="alert">{state.message}</p>}
    <button type="submit" className="link-button link-button--danger" disabled={pending}>{pending ? "Deleting..." : "Delete record"}</button>
  </form>;
}

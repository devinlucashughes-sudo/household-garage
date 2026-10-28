"use client";

import { useEffect, useRef } from "react";
import { MaintenanceCompleteForm } from "./maintenance-complete-form";

type FormProps = React.ComponentProps<typeof MaintenanceCompleteForm>;

/**
 * Mark done as a sheet over the schedule: a button on the page, the form in a modal dialog. The ledger's
 * Mark done buttons link here with ?mark=1, which opens it straight away.
 */
export function MarkDoneSheet({ title, urgent, openOnLoad, ...form }: FormProps & { title: string; urgent: boolean; openOnLoad: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (openOnLoad && !dialog.current?.open) dialog.current?.showModal();
  }, [openOnLoad]);
  const close = () => {
    if (dialog.current?.open) dialog.current.close();
    // Drop ?mark=1 so going back or reloading doesn't pop the sheet open again.
    const url = new URL(window.location.href);
    if (url.searchParams.has("mark")) { url.searchParams.delete("mark"); history.replaceState(history.state, "", url); }
  };
  return <>
    <button type="button" className={`button button--wide${urgent ? " button--soft-red" : ""}`} onClick={() => dialog.current?.showModal()}>Mark done</button>
    <dialog ref={dialog} className="sheet" aria-labelledby="maintenance-done" onClose={close}
      onClick={(event) => { if (event.target === dialog.current) close(); }}>
      <div className="sheet-body">
        <div className="sheet-head">
          <h2 id="maintenance-done">Mark done<span>{title}</span></h2>
          <button type="button" className="fill-close" aria-label="Close" onClick={close}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <MaintenanceCompleteForm {...form} />
      </div>
    </dialog>
  </>;
}

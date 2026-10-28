"use client";
import Link from "next/link";
import { useActionState } from "react";
import { deleteFuelAction } from "@/app/fuel-actions";
import type { FuelFormState } from "@/lib/fuel-input";
import "@/app/fuel.css";

export function DeleteFuel({ carId, fuelId, revision }: { carId: number; fuelId: number; revision: number }) {
  const [state, action, pending] = useActionState(async (previous: FuelFormState) => {
    try { return await deleteFuelAction(carId, fuelId, revision, previous); }
    catch (error) {
      if (error && typeof error === "object" && "digest" in error && typeof error.digest === "string" && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(error.digest)) throw error;
      return { message: "The deletion could not be confirmed. Try again; an already deleted fill-up will not be deleted twice." };
    }
  }, {} as FuelFormState);
  return <form className="fuel-delete" action={action} aria-busy={pending}>
    {state.message && <div className="notice notice--error" role="alert"><p>{state.message}</p><a href={`/cars/${carId}/fuel/${fuelId}`} target="_blank" rel="noreferrer">Open the latest record in another tab</a>{state.message.includes("sign-in expired") && <a href="/sign-in" target="_blank" rel="noreferrer">Sign in in another tab</a>}</div>}
    <button className="button button--wide fuel-danger" type="submit" disabled={pending}>{pending ? "Deleting..." : "Delete fill-up"}</button>
  </form>;
}

export function FuelRouteError({ reset }: { reset: () => void }) {
  return <main className="page"><h1 className="page-title">Fuel could not be loaded</h1>
    <p role="alert">Try loading this page again. If a save was interrupted, check fuel history before adding the fill-up again.</p>
    <button type="button" className="button button--wide" onClick={reset}>Try again</button><Link className="button button--quiet" href="/">Return to garage</Link>
  </main>;
}

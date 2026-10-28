"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  beginRegistration,
  beginSignIn,
  finishRegistration,
  finishSignIn,
} from "@/app/auth-actions";

type Mode = "sign-in" | "setup" | "add";

const cancelled = (error: unknown) =>
  error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");

export function PasskeyButton({
  mode,
  setupToken,
  children,
  quiet = false,
}: {
  mode: Mode;
  setupToken?: string;
  children: React.ReactNode;
  quiet?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; good?: boolean } | null>(null);

  async function go() {
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "sign-in") {
        const optionsJSON = await beginSignIn();
        const result = await finishSignIn(await startAuthentication({ optionsJSON }));
        if (!result.ok) return setMessage({ text: result.message });
        router.replace("/");
        router.refresh();
      } else {
        const optionsJSON = await beginRegistration(setupToken);
        if (!optionsJSON) return setMessage({ text: "This link has expired or been used." });
        const result = await finishRegistration(await startRegistration({ optionsJSON }), setupToken);
        if (!result.ok) return setMessage({ text: result.message });
        if (mode === "setup") router.replace("/");
        else setMessage({ text: "Passkey added.", good: true });
        router.refresh();
      }
    } catch (error) {
      setMessage({
        text: cancelled(error)
          ? "Cancelled. Tap the button to try again."
          : mode === "sign-in"
            ? "Signing in didn't work. Try again."
            : "This device couldn't make a passkey. If it already has one for Household Garage, sign in instead.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <button
        type="button"
        className={`button button--wide${quiet ? " button--quiet" : ""}`}
        onClick={go}
        disabled={busy}
      >
        {busy ? "Waiting for your passkey…" : children}
      </button>
      {message && (
        <p className={`notice ${message.good ? "notice--good" : "notice--error"}`} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}

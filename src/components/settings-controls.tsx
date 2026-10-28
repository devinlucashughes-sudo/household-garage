"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removePasskey } from "@/app/auth-actions";
import { backUpNow, disconnectDrive } from "@/app/settings-actions";

export function RemovePasskey({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span style={{ display: "grid", justifyItems: "end" }}>
      <button
        type="button"
        className="link-button link-button--danger"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Remove the ${label} passkey? It will stop working for Household Garage.`)) return;
          start(async () => {
            const result = await removePasskey(id);
            if (!result.ok) setError(result.message);
            router.refresh();
          });
        }}
      >
        Remove
      </button>
      {error && <small role="status">{error}</small>}
    </span>
  );
}

export function BackupControls() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <button
        type="button"
        className="button button--wide"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await backUpNow();
            setMessage({ ok: result.ok, text: result.message });
          })
        }
      >
        {pending ? "Backing up…" : "Back up now"}
      </button>
      {message && (
        <p className={`notice ${message.ok ? "notice--good" : "notice--error"}`} role="status">
          {message.text}
        </p>
      )}
      <button
        type="button"
        className="link-button link-button--danger"
        disabled={pending}
        onClick={() => {
          if (confirm("Disconnect Google Drive? Weekly backups stop until you connect it again."))
            start(() => disconnectDrive());
        }}
      >
        Disconnect Google Drive
      </button>
    </div>
  );
}

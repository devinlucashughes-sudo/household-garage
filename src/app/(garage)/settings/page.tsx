import { signOut } from "@/app/auth-actions";
import Link from "next/link";
import { PasskeyButton } from "@/components/passkey-button";
import { BackupControls, RemovePasskey } from "@/components/settings-controls";
import { ReminderControls } from "@/components/reminder-controls";
import { passkeysFor } from "@/lib/auth";
import { BACKUP_EVERY_DAYS, BACKUP_FOLDER, backupStatus } from "@/lib/backup";
import { googleSettings, pushSettings } from "@/lib/config";
import { getDatabase } from "@/lib/db";
import { formatDay, formatWhen } from "@/lib/format";
import { REMINDER_EVERY_DAYS, subscriptionsFor } from "@/lib/push";
import { requireUser } from "@/lib/session";

const driveMessages: Record<string, { text: string; good?: boolean }> = {
  connected: { text: "Google Drive is connected. Tap “Back up now” to send the first backup.", good: true },
  cancelled: { text: "Google Drive wasn't connected." },
  failed: { text: "Connecting Google Drive didn't work. Try again." },
  "not-set-up": { text: "Google Drive isn't set up on the server yet." },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string }>;
}) {
  const user = await requireUser();
  const db = getDatabase();
  const keys = passkeysFor(db, user.id);
  const backup = backupStatus(db);
  const driveMessage = driveMessages[(await searchParams).drive ?? ""];
  const driveReady = googleSettings() !== null;
  const push = pushSettings();
  const devices = subscriptionsFor(db);

  return (
    <main className="page">
      <header className="masthead">
        <h1 className="page-title">Settings</h1>
        <span className="label">{user.name}</span>
      </header>

      <section className="panel" aria-labelledby="desktop-imports">
        <h2 id="desktop-imports">Desktop imports</h2>
        <p className="lede">Send extracted receipts or schedules from your desktop, then review them here before saving.</p>
        <Link className="button button--quiet button--wide" href="/imports">Review imports</Link>
        <Link className="link-button" href="/imports/access">Manage desktop access</Link>
      </section>

      <section className="panel" aria-labelledby="reminders">
        <h2 id="reminders">Reminders</h2>
        <p className="lede">
          Each morning Garage checks what&rsquo;s due. When something is due soon or overdue, your phone gets a
          reminder, repeated every {REMINDER_EVERY_DAYS} days until you mark it done.
        </p>
        {devices.length > 0 && (
          <ul className="rows">
            {devices.map((device) => (
              <li className="row" key={device.id}>
                <span>
                  {device.label}
                  <small>
                    On since {formatDay(device.createdAt)} · last delivered {formatWhen(device.lastSuccessAt)}
                    {device.lastError ? ` · last problem: ${device.lastError}` : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
        {push ? <ReminderControls publicKey={push.publicKey} /> : <p className="notice">Reminders aren&rsquo;t set up on the server yet.</p>}
      </section>

      <section className="panel" aria-labelledby="passkeys">
        <h2 id="passkeys">Your passkeys</h2>
        <ul className="rows">
          {keys.map((key) => (
            <li className="row" key={key.id}>
              <span>
                {key.label}
                <small>
                  Added {formatDay(key.createdAt)} · last used {formatWhen(key.lastUsedAt)}
                </small>
              </span>
              <RemovePasskey id={key.id} label={key.label} />
            </li>
          ))}
        </ul>
        <PasskeyButton mode="add" quiet>
          Add a passkey on this device
        </PasskeyButton>
      </section>

      <section className="panel" aria-labelledby="backups">
        <h2 id="backups">Backups</h2>
        {driveMessage && (
          <p className={`notice ${driveMessage.good ? "notice--good" : "notice--error"}`}>
            {driveMessage.text}
          </p>
        )}
        <p className="lede">
          Every {BACKUP_EVERY_DAYS} days a copy goes to the “{BACKUP_FOLDER}” folder in the connected
          Google Drive. It keeps this week&rsquo;s and last week&rsquo;s.
        </p>
        <ul className="rows">
          <li className="row">
            <span>Last backup</span>
            <span>{formatWhen(backup.lastBackupAt)}</span>
          </li>
        </ul>
        {backup.lastError && (
          <p className="notice notice--error">
            The last try failed ({formatWhen(backup.lastErrorAt)}): {backup.lastError}
          </p>
        )}
        {backup.driveConnected ? (
          <BackupControls />
        ) : driveReady ? (
          <a className="button button--wide" href="/api/google/connect">
            Connect Google Drive
          </a>
        ) : (
          <p className="notice">Google Drive isn&rsquo;t set up on the server yet.</p>
        )}
      </section>

      <form action={signOut}>
        <button type="submit" className="button button--quiet button--wide">
          Sign out on this device
        </button>
      </form>
    </main>
  );
}

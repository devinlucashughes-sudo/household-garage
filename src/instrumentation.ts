/**
 * Runs once when the server starts. In production it checks hourly whether a weekly backup is due and
 * whether today's maintenance reminder should go out.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { backupDue, backupStatus, runBackup } = await import("./lib/backup");
  const { getConnection } = await import("./lib/db");
  const { runReminderCheck, webPushSender } = await import("./lib/push");
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const { db, sqlite } = getConnection();
      const status = backupStatus(db);
      // After a failure, wait a day before trying again on its own.
      const recentFailure =
        status.lastErrorAt !== null && Date.now() - status.lastErrorAt < 24 * 60 * 60 * 1000;
      if (status.driveConnected && backupDue(status.lastBackupAt) && !recentFailure) {
        await runBackup(db, sqlite);
        console.log("Weekly backup sent to Google Drive.");
      }
    } catch (error) {
      console.error(`Backup check failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
    try {
      const result = await runReminderCheck(getConnection().db, webPushSender());
      if (result.sent) console.log(`Maintenance reminder sent to ${result.delivered} device(s).`);
      if ((result.sent || result.reason === "failed") && result.failed)
        console.error(`Maintenance reminder failed on ${result.failed} device(s); will retry next hour.`);
      else if (result.reason === "failed") console.error("Maintenance reminder could not be delivered; see Settings for the device error.");
    } catch (error) {
      console.error(`Reminder check failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      running = false;
    }
  };
  setTimeout(check, 2 * 60 * 1000).unref();
  setInterval(check, 60 * 60 * 1000).unref();
}

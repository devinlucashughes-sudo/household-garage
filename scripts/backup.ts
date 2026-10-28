import "./env";
import { BackupError, runBackup } from "../src/lib/backup";
import { databasePath } from "../src/lib/config";
import { openDatabase } from "../src/lib/db";

// Sends a backup to Google Drive now, the same as the button in Settings.
const { db, sqlite } = openDatabase(databasePath());
try {
  await runBackup(db, sqlite);
  console.log("Backed up to Google Drive.");
} catch (error) {
  console.error(error instanceof BackupError ? error.message : "The backup failed.");
  process.exitCode = 1;
} finally {
  sqlite.close();
}

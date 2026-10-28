import "./env";
import { BackupError, prepareRestoreCopy, downloadLatest } from "../src/lib/backup";
import { databasePath } from "../src/lib/config";
import { openDatabase } from "../src/lib/db";
import { RestoreError, stageRestore } from "../src/lib/restore";

// Restore, step 1 of 2: downloads the latest Drive backup, checks it, and stages it.
// Step 2: restart the app (railway restart --service garage). The start swaps it in and moves the
// old database into /data/recovery-<time>/. Anything entered since the backup is lost.
const path = databasePath();
const { db, sqlite } = openDatabase(path);
try {
  const bytes = await downloadLatest(db);
  const prepared = prepareRestoreCopy(bytes, sqlite);
  const staged = stageRestore(path, prepared.bytes);
  console.log(`Staged the latest Drive backup at ${staged}.`);
  for (const r of prepared.rows) console.log(`  ${r.table}: ${r.backup} in backup, ${r.live} live now`);
  console.log("Restart the app to swap it in.");
} catch (error) {
  console.error(
    error instanceof BackupError || error instanceof RestoreError ? error.message : "Staging failed.",
  );
  process.exitCode = 1;
} finally {
  sqlite.close();
}

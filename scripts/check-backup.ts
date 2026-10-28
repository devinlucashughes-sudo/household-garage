import "./env";
import { BackupError, checkLatestBackup } from "../src/lib/backup";
import { databasePath } from "../src/lib/config";
import { openDatabase } from "../src/lib/db";

// Restore rehearsal: downloads the latest Drive backup and checks it could replace the live
// database, without touching the live one. Run on the server: npm run -s backup:check
const { db, sqlite } = openDatabase(databasePath());
try {
  const rows = await checkLatestBackup(db, sqlite);
  console.log("The latest Drive backup passes integrity checks and can be migrated to this release.");
  for (const r of rows) console.log(`  ${r.table}: ${r.backup} in backup, ${r.live} live`);
} catch (error) {
  console.error(error instanceof BackupError ? error.message : "The check failed.");
  process.exitCode = 1;
} finally {
  sqlite.close();
}

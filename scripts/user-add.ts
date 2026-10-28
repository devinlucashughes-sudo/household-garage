import "./env";
import { databasePath } from "../src/lib/config";
import { openDatabase } from "../src/lib/db";
import { addHouseholdUser } from "../src/lib/household";

const [handle, name, ...extra] = process.argv.slice(2);
if (!handle || !name || extra.length) {
  console.error('Usage: npm run user:add -- <handle> "Display name"');
  process.exit(1);
}
const { db, sqlite } = openDatabase(databasePath());
try {
  const user = addHouseholdUser(db, handle, name);
  console.log(`Created ${user.name} (${user.handle}).`);
  console.log(`Next: npm run auth:link -- ${user.handle}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not create the user.");
  process.exitCode = 1;
} finally {
  sqlite.close();
}

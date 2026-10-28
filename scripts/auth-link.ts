import "./env";
import { createSetupLink, SETUP_LINK_HOURS, userByHandle } from "../src/lib/auth";
import { databasePath, webAuthnSettings } from "../src/lib/config";
import { openDatabase } from "../src/lib/db";

// Makes a one-time link that lets someone add a passkey: first setup, a lost passkey, or a
// new device without 1Password. Usage: npm run -s auth:link -- owner
const handle = process.argv[2];
if (!handle) {
  console.error("Say whose link to make, for example: npm run -s auth:link -- owner");
  process.exit(1);
}
const { db, sqlite } = openDatabase(databasePath());
try {
  const user = userByHandle(db, handle);
  if (!user) {
    console.error(`No one called "${handle}". Create the user first with npm run user:add -- <handle> "Display name".`);
    process.exitCode = 1;
  } else {
    const token = createSetupLink(db, user.id);
    console.log(`Setup link for ${user.name} (one use, ${SETUP_LINK_HOURS} hours):`);
    console.log(`${webAuthnSettings().origin}/setup/${token}`);
  }
} finally {
  sqlite.close();
}

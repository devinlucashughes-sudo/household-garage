import "./env";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { databasePath, webAuthnSettings } from "../src/lib/config";
import { openDatabase } from "../src/lib/db";
import { applyStagedRestore } from "../src/lib/restore";

// Production start: check settings, swap in a staged restore if there is one, create or migrate
// the database, then serve.
(process.env as Record<string, string | undefined>).NODE_ENV ??= "production";
try {
  if (!existsSync(".next/BUILD_ID")) throw new Error("Run npm run build first.");
  webAuthnSettings();
  const recovery = applyStagedRestore(databasePath());
  if (recovery) console.log(`Restored the staged backup. The previous database is in ${recovery}.`);
  const { sqlite } = openDatabase(databasePath());
  sqlite.close();
  console.log("Database ready.");
} catch (error) {
  console.error(`App not started. ${error instanceof Error ? error.message : ""}`);
  process.exit(1);
}

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "start", ...process.argv.slice(2)], {
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

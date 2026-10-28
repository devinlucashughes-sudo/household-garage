import { existsSync } from "node:fs";

// Existing environment values win; local values take precedence over .env.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

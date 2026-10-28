import { openDatabase as openRealDatabase } from "@/lib/db";
import { users } from "@/lib/schema";

/** Synthetic users belong in test fixtures, never in application migrations. */
export function openDatabase(databasePath: string) {
  const connection = openRealDatabase(databasePath);
  connection.db.insert(users).values([
    { id: 1, handle: "owner", name: "Owner", createdAt: 1 },
    { id: 2, handle: "member", name: "Member", createdAt: 1 },
  ]).onConflictDoNothing().run();
  return connection;
}

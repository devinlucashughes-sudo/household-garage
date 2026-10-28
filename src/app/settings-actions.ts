"use server";

import { revalidatePath } from "next/cache";
import { BackupError, runBackup, writeSetting } from "@/lib/backup";
import { getConnection } from "@/lib/db";
import { requireUser } from "@/lib/session";

export async function backUpNow(): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const { db, sqlite } = getConnection();
  try {
    await runBackup(db, sqlite);
    return { ok: true, message: "Backed up to Google Drive." };
  } catch (error) {
    return { ok: false, message: error instanceof BackupError ? error.message : "The backup failed." };
  } finally {
    revalidatePath("/settings");
  }
}

export async function disconnectDrive() {
  await requireUser();
  writeSetting(getConnection().db, "google_refresh_token", null);
  revalidatePath("/settings");
}

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { writeSetting } from "@/lib/backup";
import { googleSettings, webAuthnSettings } from "@/lib/config";
import { getDatabase } from "@/lib/db";
import { GOOGLE_STATE_COOKIE, exchangeCode } from "@/lib/drive";
import { currentUser } from "@/lib/session";

/** Google sends the person back here after they allow (or refuse) Drive access. */
export async function GET(request: NextRequest) {
  const { origin } = webAuthnSettings();
  const back = (result: string) => NextResponse.redirect(`${origin}/settings?drive=${result}`);
  const jar = await cookies();
  const expected = jar.get(GOOGLE_STATE_COOKIE)?.value;
  jar.delete(GOOGLE_STATE_COOKIE);
  const params = request.nextUrl.searchParams;
  const google = googleSettings();
  if (!(await currentUser())) return NextResponse.redirect(`${origin}/sign-in`);
  if (!google || !expected || params.get("state") !== expected) return back("failed");
  const code = params.get("code");
  if (!code) return back("cancelled");
  try {
    const refreshToken = await exchangeCode(google, code, `${origin}/api/google/callback`);
    const db = getDatabase();
    writeSetting(db, "google_refresh_token", refreshToken);
    writeSetting(db, "backup_error", null);
    writeSetting(db, "backup_error_at", null);
  } catch {
    return back("failed");
  }
  return back("connected");
}

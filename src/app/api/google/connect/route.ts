import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { newToken } from "@/lib/auth";
import { googleSettings, webAuthnSettings } from "@/lib/config";
import { GOOGLE_STATE_COOKIE, consentUrl } from "@/lib/drive";
import { cookieOptions, currentUser } from "@/lib/session";

/** Sends the signed-in person to Google to allow backups into their Drive. */
export async function GET() {
  const { origin } = webAuthnSettings();
  if (!(await currentUser())) return NextResponse.redirect(`${origin}/sign-in`);
  const google = googleSettings();
  if (!google) return NextResponse.redirect(`${origin}/settings?drive=not-set-up`);
  const state = newToken();
  (await cookies()).set(GOOGLE_STATE_COOKIE, state, { ...cookieOptions(), maxAge: 10 * 60 });
  return NextResponse.redirect(consentUrl(google, `${origin}/api/google/callback`, state));
}

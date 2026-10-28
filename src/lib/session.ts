import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, userForSession } from "./auth";
import { isProduction } from "./config";
import { getDatabase } from "./db";

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userForSession(getDatabase(), token);
}

/** The signed-in person, or a redirect to sign-in. Every page and action behind sign-in calls this. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return user;
}

export const cookieOptions = (expires?: Date) => ({
  httpOnly: true,
  secure: isProduction(),
  sameSite: "lax" as const,
  path: "/",
  ...(expires ? { expires } : {}),
});

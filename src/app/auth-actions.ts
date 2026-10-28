"use server";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
  createSession,
  endSession,
  passkeyLabel,
  passkeysFor,
  saveChallenge,
  takeChallenge,
  redeemSetupLink,
  userForSetupLink,
  type User,
} from "@/lib/auth";
import { webAuthnSettings } from "@/lib/config";
import { getDatabase } from "@/lib/db";
import { passkeys } from "@/lib/schema";
import { cookieOptions, currentUser, requireUser } from "@/lib/session";

type Result = { ok: true } | { ok: false; message: string };
const failed = (message: string): Result => ({ ok: false, message });

async function startSession(userId: number) {
  const { token, expiresAt } = createSession(getDatabase(), userId);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(new Date(expiresAt)));
}

async function rememberChallenge(id: string) {
  (await cookies()).set(CHALLENGE_COOKIE, id, {
    ...cookieOptions(),
    maxAge: 5 * 60,
  });
}

async function takeChallengeCookie() {
  const jar = await cookies();
  const id = jar.get(CHALLENGE_COOKIE)?.value;
  jar.delete(CHALLENGE_COOKIE);
  return id;
}

/** The person adding a passkey: from a setup link, or the signed-in person. */
async function registrant(setupToken?: string): Promise<User | null> {
  if (setupToken) return userForSetupLink(getDatabase(), setupToken);
  return currentUser();
}

// Adding a passkey

export async function beginRegistration(setupToken?: string) {
  const user = await registrant(setupToken);
  if (!user) return null;
  const { rpID, rpName } = webAuthnSettings();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.name,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(`garage-user-${user.id}`),
    attestationType: "none",
    excludeCredentials: passkeysFor(getDatabase(), user.id).map((p) => ({
      id: p.id,
      transports: p.transports ? JSON.parse(p.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });
  await rememberChallenge(
    saveChallenge(getDatabase(), options.challenge, "register", user.id),
  );
  return options;
}

export async function finishRegistration(
  response: RegistrationResponseJSON,
  setupToken?: string,
): Promise<Result> {
  const db = getDatabase();
  const challenge = takeChallenge(db, await takeChallengeCookie(), "register");
  const user = await registrant(setupToken);
  if (!challenge || !user || challenge.userId !== user.id)
    return failed("That took too long or the link has been used. Try again.");
  const { origin, rpID } = webAuthnSettings();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch {
    return failed("The passkey couldn't be checked. Try again.");
  }
  if (!verification.verified) return failed("The passkey couldn't be checked. Try again.");
  if (setupToken && !redeemSetupLink(db, setupToken))
    return failed("This setup link has already been used.");
  const { credential, aaguid } = verification.registrationInfo;
  db.insert(passkeys)
    .values({
      id: credential.id,
      userId: user.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      label: passkeyLabel(aaguid),
      createdAt: Date.now(),
    })
    .run();
  if (setupToken) await startSession(user.id);
  return { ok: true };
}

// Signing in

export async function beginSignIn() {
  const { rpID } = webAuthnSettings();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
  });
  await rememberChallenge(
    saveChallenge(getDatabase(), options.challenge, "sign-in", null),
  );
  return options;
}

export async function finishSignIn(response: AuthenticationResponseJSON): Promise<Result> {
  const db = getDatabase();
  const challenge = takeChallenge(db, await takeChallengeCookie(), "sign-in");
  if (!challenge) return failed("That took too long. Try again.");
  const passkey = db.select().from(passkeys).where(eq(passkeys.id, response.id)).get();
  if (!passkey) return failed("This passkey isn't set up for Household Garage.");
  const { origin, rpID } = webAuthnSettings();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports
          ? (JSON.parse(passkey.transports) as AuthenticatorTransport[])
          : undefined,
      },
    });
  } catch {
    return failed("The passkey couldn't be checked. Try again.");
  }
  if (!verification.verified) return failed("The passkey couldn't be checked. Try again.");
  db.update(passkeys)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: Date.now() })
    .where(eq(passkeys.id, passkey.id))
    .run();
  await startSession(passkey.userId);
  return { ok: true };
}

// Managing passkeys and signing out

export async function removePasskey(id: string): Promise<Result> {
  const user = await requireUser();
  const db = getDatabase();
  if (passkeysFor(db, user.id).length <= 1)
    return failed("This is your only passkey. Add another before removing it.");
  db.delete(passkeys)
    .where(and(eq(passkeys.id, id), eq(passkeys.userId, user.id)))
    .run();
  return { ok: true };
}

export async function signOut() {
  const jar = await cookies();
  endSession(getDatabase(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/sign-in");
}

import { AppIcon } from "@/components/app-icon";
import Link from "next/link";
import { PasskeyButton } from "@/components/passkey-button";
import { userForSetupLink } from "@/lib/auth";
import { getDatabase } from "@/lib/db";

export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = userForSetupLink(getDatabase(), token);
  return (
    <main className="page page--bare">
      <div className="empty">
        <h1 className="brand brand--large"><AppIcon />Household Garage</h1>
      </div>
      {user ? (
        <>
          <h2 className="page-title">Hi {user.name}. Make your passkey.</h2>
          <p className="lede">
            Save it in 1Password (or iCloud Keychain). After this you sign in with Face ID, on any
            device where that passkey is saved.
          </p>
          <PasskeyButton mode="setup" setupToken={token}>
            Make my passkey
          </PasskeyButton>
        </>
      ) : (
        <>
          <h2 className="page-title">This link has expired or been used.</h2>
          <p className="lede">Ask your server administrator for a new one, or sign in if you already have a passkey.</p>
          <Link className="button button--quiet" href="/sign-in">
            Go to sign in
          </Link>
        </>
      )}
    </main>
  );
}

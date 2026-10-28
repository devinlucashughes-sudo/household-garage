import { AppIcon } from "@/components/app-icon";
import { redirect } from "next/navigation";
import { InstallHint } from "@/components/install-hint";
import { PasskeyButton } from "@/components/passkey-button";
import { currentUser } from "@/lib/session";

export default async function SignInPage() {
  if (await currentUser()) redirect("/");
  return (
    <main className="page page--bare">
      <div className="empty">
        <h1 className="brand brand--large"><AppIcon />Household Garage</h1>
        <p className="lede">Your household garage</p>
      </div>
      <PasskeyButton mode="sign-in">Sign in with passkey</PasskeyButton>
      <p className="lede">
        Your passkey lives in 1Password or iCloud Keychain. No passkey yet? Your server administrator can make you a
        setup link.
      </p>
      <InstallHint />
    </main>
  );
}

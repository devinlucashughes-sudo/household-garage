import { AppIcon } from "@/components/app-icon";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy · Household Garage" };

/** Public page. Google's consent screen links here. */
export default function PrivacyPage() {
  return (
    <main className="page page--bare" style={{ alignContent: "start" }}>
      <h1 className="brand"><AppIcon />Household Garage</h1>
      <h2 className="page-title">Privacy</h2>
      <p>
        Each Household Garage installation is intended for one household. Accounts are created by
        the server administrator; there is no public sign-up.
      </p>
      <p>
        It stores what the household enters about its own cars: vehicles, fuel, service records,
        receipts and manuals. That information is kept on the server operated by your administrator. The application has
        no advertising or analytics integration. Ask your administrator about hosting and access.
      </p>
      <p>
        <strong>Google Drive.</strong> If a household member connects Google Drive, the app uses the
        &ldquo;drive.file&rdquo; permission to save backup copies of its own data into a folder it
        creates. It can only see files it made itself. It cannot read anything else in Drive.
        Access can be removed at any time in Settings or in your Google Account under
        &ldquo;Third-party apps &amp; services&rdquo;.
      </p>
      <p>
        <strong>Sign-in</strong> uses passkeys. The app stores only each passkey&rsquo;s public key, and
        a cookie keeps each device signed in.
      </p>
      <p className="lede">VIN lookup sends the entered VIN to NHTSA vPIC. Optional push reminders send notification
        content through the device push provider. Direct privacy questions to your server administrator.</p>
    </main>
  );
}

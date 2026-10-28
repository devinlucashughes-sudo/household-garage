import Link from "next/link";
import { getDatabase } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { importTokensFor } from "@/lib/imports";
import { ImportAccessCreate, ImportAccessRevoke } from "@/components/import-controls";
import "@/app/imports.css";

export default async function ImportAccessPage() {
  await requireUser(); const tokens = importTokensFor(getDatabase());
  return <main className="page imports-page"><Link href="/imports">Desktop imports</Link>
    <h1 className="page-title">Desktop access</h1>
    <p className="lede">A desktop credential can list cars and submit pending drafts and originals. Only someone signed in here can correct, approve or reject them. Credentials are stored as hashes and cannot be shown again.</p>
    <ImportAccessCreate />
    <section className="panel"><h2>Existing access</h2>
      {!tokens.length ? <p className="lede">No desktop access created.</p> : <ul className="rows">{tokens.map((t) => <li key={t.id} className="import-access-row"><strong>{t.name}</strong><p className="lede">{t.revokedAt !== null ? "Revoked" : "Active"} · Created {new Date(t.createdAt).toLocaleDateString("en-US")}</p><p className="lede">{t.lastUsedAt === null ? "Never used" : `Last used ${new Date(t.lastUsedAt).toLocaleDateString("en-US")}`}</p>{t.revokedAt === null && <ImportAccessRevoke id={t.id} />}</li>)}</ul>}
    </section>
  </main>;
}

import Link from "next/link";
import { getDatabase } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { importsFor } from "@/lib/imports";
import { cars } from "@/lib/schema";
import { ImportPaste } from "@/components/import-controls";
import "@/app/imports.css";

export default async function ImportsPage() {
  await requireUser(); const db = getDatabase();
  const drafts = importsFor(db), names = new Map(db.select().from(cars).all().map((c) => [c.id, c.nickname]));
  return <main className="page imports-page">
    <Link href="/">Garage</Link><h1 className="page-title">Desktop imports</h1>
    <p className="lede">Review extracted records before adding them to your garage. Pending and rejected drafts do not change mileage, history or spending.</p>
    <Link href="/imports/access" className="button button--quiet">Manage desktop access</Link>
    <section className="panel"><h2>Imports</h2>
      {!drafts.length ? <p className="lede">No imports yet. Submit from your desktop or paste JSON below.</p> : <ul className="rows">{drafts.map((d) => <li key={d.id} className="row"><Link href={`/imports/${d.id}`} className="import-row-link"><strong>{String(JSON.parse(d.payload).title)}</strong><small>{names.get(d.carId)} · {d.type === "service" ? "Service or quote" : "Maintenance schedule"} · {d.status === "draft" ? "Pending review" : d.status}</small>{d.sourceLabel && <small>{d.sourceLabel}</small>}</Link></li>)}</ul>}
    </section>
    <section className="panel"><h2>Car IDs for desktop JSON</h2><ul className="rows">{[...names].map(([id, name]) => <li className="row" key={id}>{name}<span>carId: {id}</span></li>)}</ul></section>
    <ImportPaste />
  </main>;
}

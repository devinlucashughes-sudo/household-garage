import Link from "next/link";
import { carTone } from "@/lib/car-tone";
import type { LedgerItem, LedgerTone } from "@/lib/maintenance-ledger";
import "@/app/maintenance.css";

const toneClass: Record<LedgerTone, string> = { due: "is-due", soon: "is-soon", unknown: "is-unknown", ok: "", off: "is-off" };
const headClass: Record<string, string> = { overdue: "is-due", "due-soon": "is-soon", "needs-baseline": "is-unknown", optional: "is-optional" };

/** One ledger card: rows link to the schedule; due rows can offer Mark done right there. */
export function LedgerList({ items, showCar = false, markDone = false, compact = false, more }: {
  items: LedgerItem[]; showCar?: boolean; markDone?: boolean; compact?: boolean; more?: { href: string; label: string };
}) {
  return <ul className="ledger">
    {items.map(({ carId, carName, due, line }) => {
      const href = `/cars/${carId}/maintenance/${due.schedule.id}`;
      return <li key={due.schedule.id}>
        <Link className="ledger-row" href={href}>
          <span className="ledger-what">
            {showCar && <span className={`tag ${carTone(carId)}`}>{carName}</span>}
            <strong>{due.schedule.title}</strong>
            <small>{line.interval}{!compact && line.lastDone ? ` · ${line.lastDone}` : ""}</small>
            {due.schedule.optional && <small className="ledger-optional">Optional: the owner&apos;s manual doesn&apos;t call for it</small>}
          </span>
          <span className="ledger-when">{line.limit}<small className={toneClass[line.tone]}>{line.status}</small></span>
        </Link>
        {markDone && (line.tone === "due" || line.tone === "soon") && <div className="ledger-actions">
          <Link className="button button--soft-red" href={`${href}?mark=1`}>Mark done</Link>
        </div>}
      </li>;
    })}
    {more && <li><Link className="ledger-more" href={more.href}>{more.label} ›</Link></li>}
  </ul>;
}

/** The whole ledger: a heading and card per group, overdue first. */
export function MaintenanceLedger({ groups, showCar = false, markDone = false }: {
  groups: { key: string; title: string; items: LedgerItem[] }[]; showCar?: boolean; markDone?: boolean;
}) {
  return <>{groups.map((group) => <section key={group.key} aria-labelledby={`ledger-${group.key}`} className="ledger-section">
    <div className="section-head"><h2 id={`ledger-${group.key}`} className={headClass[group.key]}>{group.title} · {group.items.length}</h2></div>
    <LedgerList items={group.items} showCar={showCar} markDone={markDone} />
  </section>)}</>;
}

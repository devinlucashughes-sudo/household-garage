"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { yearHref } from "@/lib/reports";

/** All time, then each year with records, newest first. Keeps the chosen year in view when the row scrolls. */
export function PeriodPills({ href, years, selected }: { href: string; years: string[]; selected: string | null }) {
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    const current = row.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && row.current) row.current.scrollLeft = current.offsetLeft - (row.current.clientWidth - current.offsetWidth) / 2;
  }, [selected]);
  const list = selected && !years.includes(selected) ? [...years, selected].sort().reverse() : years;
  return <nav className="periods" aria-label="Period" ref={row}>
    <Link href={href} aria-current={selected ? undefined : "page"} scroll={false}>All time</Link>
    {list.map((year) => <Link key={year} href={yearHref(href, year)} aria-current={year === selected ? "page" : undefined} scroll={false}>{year}</Link>)}
  </nav>;
}

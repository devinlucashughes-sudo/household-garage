import type { CostCategory } from "@/lib/cost-categories";

const paths: Record<CostCategory, React.ReactNode> = {
  fuel: <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0v-7l-3-3M8 7h4" />,
  oil: <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />,
  tires: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></>,
  maintenance: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />,
  repairs: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  body: <path d="M3 16v-4l2-5h14l2 5v4M3 16h18M3 16v2h3v-2M18 16v2h3v-2M7 12h.01M17 12h.01" />,
};

/** A small line drawing for each kind of cost, drawn in the kind's color by `.cat-*` in reports.css. */
export function CategoryIcon({ category, size = 16 }: { category: CostCategory; size?: number }) {
  return <svg className="cat-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{paths[category]}</svg>;
}

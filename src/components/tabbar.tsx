"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeGarageTab, type GarageTab } from "@/lib/navigation";

const icons: Record<GarageTab, React.ReactNode> = {
  garage: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  maintenance: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4M8 15h3" /></>,
  fuel: <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0v-7l-3-3M8 7h4" />,
  reports: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
};

// Fill-up sits in the middle, in easy thumb reach: it is the most frequent job.
const tabs = [
  { href: "/", label: "Home", key: "garage" },
  { href: "/maintenance", label: "Due", key: "maintenance" },
  { href: "/fuel", label: "Fill-up", key: "fuel" },
  { href: "/reports", label: "Costs", key: "reports" },
  { href: "/settings", label: "Settings", key: "settings" },
] satisfies { href: string; label: string; key: GarageTab }[];

export function TabBar() {
  const path = usePathname();
  const active = activeGarageTab(path);
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar-inner">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={tab.key === "fuel" ? "tab tab--fill" : "tab"}
            aria-current={active === tab.key ? "page" : undefined}
          >
            <span className="tab-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">{icons[tab.key]}</svg>
            </span>
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

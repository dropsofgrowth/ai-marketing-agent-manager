"use client";

import {
  BarChart3,
  LayoutDashboard,
  Megaphone,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/i18n/client";
import type { Dictionary } from "@/i18n/dictionaries";
import { cn } from "@/lib/cn";

type NavKey = keyof Pick<
  Dictionary["nav"],
  "overview" | "metaAds" | "shopify" | "creatives" | "analytics" | "automations" | "approvals" | "settings"
>;

type NavItem = { key: NavKey; path: string; icon: LucideIcon };

const GROUPS: { label: "groupChannels" | "groupAgent" | null; items: NavItem[] }[] = [
  { label: null, items: [{ key: "overview", path: "", icon: LayoutDashboard }] },
  {
    label: "groupChannels",
    items: [
      { key: "metaAds", path: "/meta-ads", icon: Megaphone },
      { key: "shopify", path: "/shopify", icon: ShoppingBag },
      { key: "creatives", path: "/creatives", icon: Sparkles },
      { key: "analytics", path: "/analytics", icon: BarChart3 },
    ],
  },
  {
    label: "groupAgent",
    items: [
      { key: "approvals", path: "/approvals", icon: ShieldCheck },
      { key: "automations", path: "/automations", icon: Workflow },
      { key: "settings", path: "/settings", icon: Settings },
    ],
  },
];

/** Primary navigation. `pendingCount` is null while the count is still streaming in. */
export function NavLinks({ pendingCount, onNavigate }: { pendingCount: number | null; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { locale, dict, t } = useI18n();
  const base = `/${locale}`;

  return (
    <nav aria-label={dict.nav.main} className="flex flex-col gap-5">
      {GROUPS.map((group, index) => (
        <div key={group.label ?? index}>
          {group.label ? (
            <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              {dict.nav[group.label]}
            </p>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {group.items.map(({ key, path, icon: Icon }) => {
              const href = `${base}${path}`;
              const active = path === "" ? pathname === base : pathname.startsWith(href);
              const showCount = key === "approvals" && pendingCount !== null && pendingCount > 0;
              return (
                <li key={key}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-accent-soft font-medium text-accent-ink"
                        : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{dict.nav[key]}</span>
                    {showCount ? (
                      <span
                        className="tabular rounded-full bg-accent px-1.5 text-[11px] leading-5 font-semibold text-on-accent"
                        aria-label={t(dict.nav.pendingCount, { count: pendingCount })}
                      >
                        {pendingCount}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

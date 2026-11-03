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

export type NavKey = keyof Pick<
  Dictionary["nav"],
  "overview" | "metaAds" | "shopify" | "creatives" | "analytics" | "automations" | "approvals" | "settings"
>;

export type NavItem = { key: NavKey; path: string; icon: LucideIcon };

export const NAV_GROUPS: { label: "groupChannels" | "groupAgent" | null; items: NavItem[] }[] = [
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

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Whether `path` (relative to the locale root) is the current page or one of its children. */
export function isActivePath(pathname: string, base: string, path: string): boolean {
  const href = `${base}${path}`;
  return path === "" ? pathname === base || pathname === `${base}/` : pathname === href || pathname.startsWith(`${href}/`);
}

/** Small count bubble for the approvals entry. */
export function CountBadge({ count, label, className }: { count: number; label: string; className?: string }) {
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "tabular inline-grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] leading-5 font-semibold text-on-accent",
          className,
        )}
      >
        {count > 99 ? "99+" : count}
      </span>
      <span className="sr-only">({label})</span>
    </>
  );
}

/**
 * Primary navigation. `pendingCount` is null while the count is still streaming in.
 * - `list`: grouped, labelled rows (desktop sidebar and the phone "More" sheet).
 * - `rail`: icon + short caption column for tablets (md → lg).
 */
export function NavLinks({
  pendingCount,
  onNavigate,
  variant = "list",
}: {
  pendingCount: number | null;
  onNavigate?: () => void;
  variant?: "list" | "rail";
}) {
  const pathname = usePathname();
  const { locale, dict, t } = useI18n();
  const base = `/${locale}`;
  const rail = variant === "rail";

  return (
    <nav aria-label={dict.nav.main} className={cn("flex flex-col", rail ? "gap-2" : "gap-5")}>
      {NAV_GROUPS.map((group, index) => (
        <div key={group.label ?? index} className={cn(rail && index > 0 && "border-t border-line pt-2")}>
          {group.label && !rail ? (
            <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              {dict.nav[group.label]}
            </p>
          ) : null}
          <ul className={cn("flex flex-col", rail ? "gap-1" : "gap-0.5")}>
            {group.items.map(({ key, path, icon: Icon }) => {
              const href = `${base}${path}`;
              const active = isActivePath(pathname, base, path);
              const showCount = key === "approvals" && pendingCount !== null && pendingCount > 0;
              const countLabel = showCount ? t(dict.nav.pendingCount, { count: pendingCount }) : "";
              return (
                <li key={key}>
                  {rail ? (
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={dict.nav[key]}
                      className={cn(
                        "relative flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-center text-[11px] leading-tight transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        active ? "bg-accent-soft font-medium text-accent-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink active:bg-surface-2",
                      )}
                    >
                      <span className="relative">
                        <Icon aria-hidden className="size-5" />
                        {showCount ? (
                          <CountBadge count={pendingCount} label={countLabel} className="absolute -top-2 -end-3 min-w-4 px-1 text-[10px] leading-4" />
                        ) : null}
                      </span>
                      <span className="line-clamp-2 w-full hyphens-auto">{dict.nav[key]}</span>
                    </Link>
                  ) : (
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors pointer-coarse:min-h-11",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        active
                          ? "bg-accent-soft font-medium text-accent-ink"
                          : "text-ink-2 hover:bg-surface-2 hover:text-ink active:bg-surface-2",
                      )}
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      <span className="flex-1 truncate">{dict.nav[key]}</span>
                      {showCount ? <CountBadge count={pendingCount} label={countLabel} /> : null}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

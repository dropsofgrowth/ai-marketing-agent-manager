"use client";

import { LayoutGrid, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

import { CountBadge, NAV_ITEMS, NavLinks, isActivePath, type NavKey } from "./nav";
import { UserCard } from "./user-card";

/** The four destinations pinned to the phone tab bar; everything else lives under "More". */
const TAB_KEYS = ["overview", "metaAds", "shopify", "approvals"] as const satisfies readonly NavKey[];
const TABS = TAB_KEYS.map((key) => ({ ...NAV_ITEMS.find((item) => item.key === key)!, key }));

const tabClass = (active: boolean) =>
  cn(
    "relative flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 text-[11px] leading-tight transition-colors",
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
    active ? "font-semibold text-accent-ink" : "text-ink-2 active:bg-surface-2",
  );

/**
 * Phone navigation (< md): a bottom tab bar within thumb reach, plus a "More"
 * bottom sheet listing every section. Respects the home-indicator safe area.
 */
export function MobileTabBar({ pendingCount }: { pendingCount: number | null }) {
  const pathname = usePathname();
  const { locale, dict, dir, t } = useI18n();
  const base = `/${locale}`;
  // The sheet belongs to the page it was opened on, so any navigation closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);
  const sheet = useRef<HTMLDialogElement>(null);
  const onTab = TABS.some((tab) => isActivePath(pathname, base, tab.path));

  useEffect(() => {
    const dialog = sheet.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <nav
        data-nav="tabbar"
        aria-label={dict.nav.mobile}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto grid h-(--tabbar-h) max-w-lg grid-cols-5 py-1 pr-[max(0.25rem,env(safe-area-inset-right))] pl-[max(0.25rem,env(safe-area-inset-left))]">
          {TABS.map(({ key, path, icon: Icon }) => {
            const active = isActivePath(pathname, base, path);
            const showCount = key === "approvals" && pendingCount !== null && pendingCount > 0;
            return (
              <li key={key}>
                <Link href={`${base}${path}`} aria-current={active ? "page" : undefined} className={tabClass(active)}>
                  {active ? <span aria-hidden className="absolute top-0 h-0.5 w-6 rounded-full bg-accent" /> : null}
                  <span className="relative">
                    <Icon aria-hidden className="size-5" strokeWidth={active ? 2.25 : 2} />
                    {showCount ? (
                      <CountBadge
                        count={pendingCount}
                        label={t(dict.nav.pendingCount, { count: pendingCount })}
                        className="absolute -top-1.5 -end-3 min-w-4 px-1 text-[10px] leading-4"
                      />
                    ) : null}
                  </span>
                  <span className="max-w-full truncate">{dict.nav.tabs[key]}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={open}
              className={tabClass(!onTab)}
            >
              {!onTab ? <span aria-hidden className="absolute top-0 h-0.5 w-6 rounded-full bg-accent" /> : null}
              <LayoutGrid aria-hidden className="size-5" strokeWidth={!onTab ? 2.25 : 2} />
              <span className="max-w-full truncate">{dict.nav.more}</span>
            </button>
          </li>
        </ul>
      </nav>

      <dialog
        ref={sheet}
        dir={dir}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === sheet.current) setOpen(false); // tap on the backdrop
        }}
        data-nav="more-sheet"
        aria-labelledby="more-sheet-title"
        className="animate-sheet-in mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-2xl border-t border-line bg-surface p-0 text-ink shadow-xl md:hidden"
      >
        <div className="px-page pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="more-sheet-title" className="text-base font-semibold">
              {dict.nav.moreTitle}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="-me-2 grid size-10 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
              aria-label={dict.shell.closeMenu}
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          {open ? <NavLinks pendingCount={pendingCount} onNavigate={() => setOpen(false)} /> : null}
          <UserCard className="mt-5" />
        </div>
      </dialog>
    </>
  );
}

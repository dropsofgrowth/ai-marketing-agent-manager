import { Database, FlaskConical } from "lucide-react";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { ServerI18n } from "@/i18n/server";
import { getEnv } from "@/server/env";
import { getPendingCount } from "@/server/queries/shell";

import { Brand } from "./brand";
import { LocaleSwitcher } from "./locale-switcher";
import { MobileTabBar } from "./mobile-nav";
import { NavLinks } from "./nav";
import { OfflineBanner } from "./offline-banner";
import { UserCard } from "./user-card";

/**
 * Responsive chrome:
 * - phones (< md): top bar + bottom tab bar with a "More" sheet
 * - tablets (md → lg): icon rail
 * - desktop (lg+): full sidebar
 * Both side navs are rendered and toggled with CSS so the server output is the
 * same for every device (no user-agent sniffing, works with prerendered shells).
 */
function SideNav({ pendingCount }: { pendingCount: number | null }) {
  return (
    <>
      <div data-nav="rail" className="flex h-full w-24 flex-col items-stretch gap-4 px-2 py-3 lg:hidden">
        <Brand iconOnly className="self-center" />
        <NavLinks pendingCount={pendingCount} variant="rail" />
        <UserCard compact className="mt-auto" />
      </div>
      <div data-nav="sidebar" className="hidden h-full w-[248px] flex-col gap-6 px-3 py-4 lg:flex">
        <div className="px-2">
          <Brand />
        </div>
        <NavLinks pendingCount={pendingCount} />
        <UserCard className="mt-auto" />
      </div>
    </>
  );
}

async function SideNavWithCount() {
  await connection();
  return <SideNav pendingCount={await getPendingCount()} />;
}

async function MobileTabBarWithCount() {
  await connection();
  return <MobileTabBar pendingCount={await getPendingCount()} />;
}

/** Request-time notices (depend on runtime env, not on the build). */
async function RuntimeNotices({ i18n }: { i18n: ServerI18n }) {
  await connection();
  const { dict } = i18n;
  const usingMemory = !getEnv().DATABASE_URL;
  return (
    <div className="px-page border-b border-line bg-accent-soft/60 py-2 text-xs text-ink sm:text-[13px]">
      <p className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-start gap-1.5">
          <FlaskConical aria-hidden className="mt-0.5 size-3.5 shrink-0 text-accent-ink" />
          <span className="sm:hidden">{dict.shell.mockBannerShort}</span>
          <span className="hidden sm:inline">{dict.shell.mockBanner}</span>
        </span>
        {usingMemory ? (
          <span className="inline-flex items-start gap-1.5 text-ink-2">
            <Database aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="sm:hidden">{dict.shell.memoryStorageShort}</span>
            <span className="hidden sm:inline">{dict.shell.memoryStorage}</span>
          </span>
        ) : null}
      </p>
    </div>
  );
}

export function AppShell({ i18n, children }: { i18n: ServerI18n; children: ReactNode }) {
  const { dict } = i18n;
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[auto_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
      >
        {dict.shell.skipToContent}
      </a>

      {/* Side navigation: rail on tablets, full sidebar on desktop. */}
      <div className="hidden border-e border-line bg-surface md:block">
        <aside className="sticky top-0 h-dvh overflow-y-auto overscroll-contain ltr:pl-[env(safe-area-inset-left)] rtl:pr-[env(safe-area-inset-right)]">
          <Suspense fallback={<SideNav pendingCount={null} />}>
            <SideNavWithCount />
          </Suspense>
        </aside>
      </div>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="px-page flex h-14 items-center gap-3">
            <div className="min-w-0 lg:hidden">
              {/* The tablet rail already shows the logo, so the header keeps only the name there. */}
              <Brand iconClassName="md:hidden" />
            </div>
            <div className="ms-auto flex shrink-0 items-center gap-2">
              <span className="hidden sm:block">
                <Badge tone="warning" icon={<FlaskConical aria-hidden className="size-3" />}>
                  {dict.shell.mockMode}
                </Badge>
              </span>
              <LocaleSwitcher />
            </div>
          </div>
        </header>
        <Suspense fallback={null}>
          <RuntimeNotices i18n={i18n} />
        </Suspense>
        <OfflineBanner />
        <main id="main" className="px-page pb-tabbar mx-auto w-full max-w-[1400px] flex-1 pt-5 sm:pt-6 md:pb-8 lg:py-8">
          {children}
        </main>
      </div>

      <Suspense fallback={<MobileTabBar pendingCount={null} />}>
        <MobileTabBarWithCount />
      </Suspense>
    </div>
  );
}

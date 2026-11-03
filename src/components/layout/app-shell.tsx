import { Database, FlaskConical } from "lucide-react";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { ServerI18n } from "@/i18n/server";
import { getEnv } from "@/server/env";
import { getPendingCount } from "@/server/queries/shell";

import { Brand } from "./brand";
import { LocaleSwitcher } from "./locale-switcher";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav";

async function SidebarNav() {
  await connection();
  return <NavLinks pendingCount={await getPendingCount()} />;
}

async function MobileNavWithCount() {
  await connection();
  return <MobileNav pendingCount={await getPendingCount()} />;
}

/** Request-time notices (depend on runtime env, not on the build). */
async function RuntimeNotices({ i18n }: { i18n: ServerI18n }) {
  await connection();
  const usingMemory = !getEnv().DATABASE_URL;
  return (
    <div className="border-b border-line bg-accent-soft/60 px-4 py-2 text-[13px] text-ink sm:px-6 lg:px-8">
      <p className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-start gap-1.5">
          <FlaskConical aria-hidden className="mt-0.5 size-3.5 shrink-0 text-accent-ink" />
          {i18n.dict.shell.mockBanner}
        </span>
        {usingMemory ? (
          <span className="inline-flex items-start gap-1.5 text-ink-2">
            <Database aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {i18n.dict.shell.memoryStorage}
          </span>
        ) : null}
      </p>
    </div>
  );
}

export function AppShell({ i18n, children }: { i18n: ServerI18n; children: ReactNode }) {
  const { dict, t } = i18n;
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
      >
        {dict.shell.skipToContent}
      </a>

      <div className="hidden border-e border-line bg-surface lg:block">
        <aside className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto px-3 py-4">
          <div className="px-2">
            <Brand />
          </div>
          <Suspense fallback={<NavLinks pendingCount={null} />}>
            <SidebarNav />
          </Suspense>
          <div className="mt-auto flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2"
            >
              DO
            </span>
            <div className="min-w-0 text-xs">
              <p className="truncate font-medium text-ink" title={t(dict.shell.signedInAs, { name: "Demo Operator" })}>
                Demo Operator
              </p>
              <p className="text-ink-2">{dict.shell.roleOwner}</p>
            </div>
          </div>
        </aside>
      </div>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <Suspense fallback={<MobileNav pendingCount={null} />}>
            <MobileNavWithCount />
          </Suspense>
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ms-auto flex items-center gap-2">
            <Badge tone="warning" icon={<FlaskConical aria-hidden className="size-3" />} className="hidden sm:inline-flex">
              {dict.shell.mockMode}
            </Badge>
            <LocaleSwitcher />
          </div>
        </header>
        <Suspense fallback={null}>
          <RuntimeNotices i18n={i18n} />
        </Suspense>
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { ApprovalCard } from "@/components/approvals/approval-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { isExpired } from "@/domain/approvals/state-machine";
import type { ApprovalRequest } from "@/domain/types";
import { getI18n, type ServerI18n } from "@/i18n/server";
import { cn } from "@/lib/cn";
import { getCurrentActor } from "@/server/auth/actor";
import { getStore } from "@/server/store";

const TABS = ["pending", "approved", "history"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: PageProps<"/[lang]/approvals">): Promise<Metadata> {
  return { title: getI18n((await params).lang).dict.approvals.title };
}

export default async function ApprovalsPage({ params, searchParams }: PageProps<"/[lang]/approvals">) {
  const i18n = getI18n((await params).lang);
  const { dict } = i18n;
  return (
    <>
      <PageHeader title={dict.approvals.title} description={dict.approvals.subtitle} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
            <ApprovalQueue i18n={i18n} searchParams={searchParams} />
          </Suspense>
        </div>
        <aside className="space-y-4 self-start">
          <Notice tone="safety">{dict.approvals.approveNotice}</Notice>
          <Card>
            <CardHeader title={dict.approvals.howItWorks} />
            <CardBody>
              <ol className="space-y-3 text-sm text-ink-2">
                {dict.approvals.steps.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-ink">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}

function tabOf(request: ApprovalRequest, now: Date): Tab {
  if (request.status === "PENDING") return isExpired(request.expiresAt, now) ? "history" : "pending";
  if (request.status === "APPROVED" || request.status === "EXECUTING") return "approved";
  return "history";
}

async function ApprovalQueue({
  i18n,
  searchParams,
}: {
  i18n: ServerI18n;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const now = new Date();
  const { dict, locale } = i18n;
  const requested = (await searchParams).tab;
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "pending";

  const actor = await getCurrentActor();
  const all = await getStore().approvals.list(actor.workspaceId, { limit: 200 });
  const byTab = Object.fromEntries(TABS.map((t) => [t, all.filter((r) => tabOf(r, now) === t)])) as Record<Tab, ApprovalRequest[]>;
  const visible = byTab[tab];

  return (
    <div className="space-y-4">
      <nav aria-label={dict.approvals.title} className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/${locale}/approvals${t === "pending" ? "" : `?tab=${t}`}`}
            aria-current={t === tab ? "page" : undefined}
            scroll={false}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap pointer-coarse:py-3",
              t === tab ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {dict.approvals.tabs[t]}
            <span className="tabular rounded-full bg-surface-2 px-1.5 text-xs text-ink-2">{byTab[t].length}</span>
          </Link>
        ))}
      </nav>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-2">
          {dict.approvals.empty[tab]}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          {visible.map((request) => (
            <ApprovalCard key={request.id} request={request} i18n={i18n} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

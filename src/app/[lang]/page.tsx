import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { RiskBadge, actorLabel, approvalHeadline, approvalSource } from "@/components/approvals/labels";
import { BarList } from "@/components/charts/bar-list";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { IntegrationList } from "@/components/integrations/integration-list";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionSkeleton } from "@/components/ui/skeleton";
import { StatTile, deltaOf } from "@/components/ui/stat-tile";
import type { AuditLogEntry } from "@/domain/types";
import { richT } from "@/i18n/rich";
import { getI18n, type ServerI18n } from "@/i18n/server";
import { getCurrentActor } from "@/server/auth/actor";
import { getIntegrationStatuses } from "@/server/queries/integrations";
import { loadCampaignRows, loadPerformance } from "@/server/queries/performance";
import { getStore } from "@/server/store";

const DAYS = 30;

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  return { title: getI18n((await params).lang).dict.overview.title };
}

export default async function OverviewPage({ params }: PageProps<"/[lang]">) {
  const i18n = getI18n((await params).lang);
  return (
    <>
      <PageHeader title={i18n.dict.overview.title} description={i18n.t(i18n.dict.overview.subtitle, { n: DAYS })} />
      <Suspense fallback={<SectionSkeleton label={i18n.dict.common.loading} />}>
        <OverviewContent i18n={i18n} />
      </Suspense>
    </>
  );
}

function auditMessage(entry: AuditLogEntry, i18n: ServerI18n) {
  const m = entry.metadata ?? {};
  const target = String(m.target ?? m.title ?? m.name ?? "");
  return richT(i18n.dict.audit[entry.action], { actor: actorLabel(entry.actorLabel, i18n), target });
}

async function OverviewContent({ i18n }: { i18n: ServerI18n }) {
  await connection();
  const now = new Date();
  const { dict, fmt, t, locale } = i18n;
  const actor = await getCurrentActor();
  const store = getStore();

  const [perf, pending, activity] = await Promise.all([
    loadPerformance(DAYS, now),
    store.approvals.list(actor.workspaceId, { statuses: ["PENDING"], limit: 4 }),
    store.audit.list(actor.workspaceId, { limit: 6 }),
  ]);
  const campaigns = await loadCampaignRows(perf.range);
  const currency = perf.account.currency;
  const pct = (f: number) => fmt.percent(f, { signed: true });
  const vs = t(dict.common.vsPrevious, { n: DAYS });

  const topCampaigns = campaigns
    .filter((c) => c.derived.roas !== null)
    .sort((a, b) => (b.derived.roas ?? 0) - (a.derived.roas ?? 0))
    .slice(0, 5);

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label={dict.kpi.revenue}
          value={fmt.currency(perf.kpis.revenue.value, currency, { compact: true })}
          delta={deltaOf(perf.kpis.revenue.delta, pct)}
          deltaLabel={vs}
          trend={perf.trends.revenue}
        />
        <StatTile
          label={dict.kpi.adSpend}
          value={fmt.currency(perf.kpis.spend.value, currency, { compact: true })}
          delta={deltaOf(perf.kpis.spend.delta, pct)}
          deltaLabel={vs}
          upIsGood={null}
          trend={perf.trends.spend}
        />
        <StatTile
          label={dict.kpi.blendedRoas}
          hint={dict.kpi.blendedRoasHint}
          value={fmt.roas(perf.kpis.blendedRoas.value)}
          delta={deltaOf(perf.kpis.blendedRoas.delta, pct)}
          deltaLabel={vs}
          trend={perf.trends.blendedRoas}
        />
        <StatTile
          label={dict.kpi.orders}
          value={fmt.number(perf.kpis.orders.value)}
          delta={deltaOf(perf.kpis.orders.delta, pct)}
          deltaLabel={vs}
          trend={perf.trends.orders}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={dict.charts.revenueVsSpend} description={dict.charts.revenueVsSpendDesc} />
          <CardBody>
            <TimeSeriesChart
              title={dict.charts.revenueVsSpend}
              dates={perf.sales.map((d) => d.date)}
              format={{ kind: "currency", currency }}
              series={[
                { id: "revenue", label: dict.charts.series.revenue, color: "series-1", values: perf.sales.map((d) => d.revenueMinor) },
                { id: "spend", label: dict.charts.series.spend, color: "series-2", values: perf.ads.map((d) => d.spendMinor) },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={dict.overview.pendingApprovals}
            action={
              <Link href={`/${locale}/approvals`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-ink hover:underline">
                {dict.common.viewAll}
                <ArrowRight aria-hidden className="size-3.5 rtl:rotate-180" />
              </Link>
            }
          />
          <CardBody>
            {pending.length === 0 ? (
              <p className="text-sm text-ink-2">{dict.overview.noPending}</p>
            ) : (
              <ul className="space-y-3">
                {pending.map((request) => (
                  <li key={request.id}>
                    <Link
                      href={`/${locale}/approvals`}
                      className="block rounded-lg border border-line p-3 transition-colors hover:bg-surface-2"
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <RiskBadge risk={request.riskLevel} i18n={i18n} />
                        <span className="text-xs text-ink-2">{fmt.relative(request.createdAt, now)}</span>
                      </div>
                      <p className="text-sm font-medium text-ink">{approvalHeadline(request, i18n)}</p>
                      <p className="mt-0.5 text-xs text-ink-2">
                        {request.type === "BUDGET_CHANGE" ? (
                          <span className="tabular inline-flex flex-wrap items-center gap-1">
                            <bdi>{fmt.currency(request.payload.currentDailyBudgetMinor, request.payload.currency)}</bdi>
                            <ArrowRight aria-hidden className="size-3 rtl:rotate-180" />
                            <bdi>{fmt.currency(request.payload.proposedDailyBudgetMinor, request.payload.currency)}</bdi>
                            <bdi>({fmt.percent(request.payload.changePercent / 100, { signed: true })})</bdi>
                          </span>
                        ) : (
                          approvalSource(request, i18n)
                        )}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader title={dict.overview.topCampaigns} description={t(dict.common.lastNDays, { n: DAYS })} />
          <CardBody>
            <BarList
              label={dict.overview.topCampaigns}
              items={topCampaigns.map((c) => ({
                id: c.campaign.id,
                label: c.campaign.name,
                value: c.derived.roas ?? 0,
                display: fmt.roas(c.derived.roas),
              }))}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={dict.overview.integrations} />
          <CardBody>
            <IntegrationList statuses={getIntegrationStatuses()} i18n={i18n} />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader title={dict.overview.recentActivity} />
          <CardBody>
            {activity.length === 0 ? (
              <p className="text-sm text-ink-2">{dict.overview.noActivity}</p>
            ) : (
              <ol className="space-y-3">
                {activity.map((entry) => (
                  <li key={entry.id} className="flex gap-3 text-sm">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line-strong" />
                    <div className="min-w-0">
                      <p className="text-ink">{auditMessage(entry, i18n)}</p>
                      <p className="text-xs text-ink-2">{fmt.relative(entry.createdAt, now)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

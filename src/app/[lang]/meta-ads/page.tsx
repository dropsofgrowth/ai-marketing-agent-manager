import { Clock } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { BudgetChangeDialog } from "@/components/approvals/budget-change-dialog";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataList, DataListItem, MetricGrid } from "@/components/ui/data-list";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionSkeleton } from "@/components/ui/skeleton";
import { StatTile, deltaOf } from "@/components/ui/stat-tile";
import { TableContainer, Td, Th } from "@/components/ui/table";
import { richT } from "@/i18n/rich";
import { getI18n, type ServerI18n } from "@/i18n/server";
import { getApprovalConfig } from "@/server/services";
import { loadCampaignRows, loadPerformance } from "@/server/queries/performance";

type CampaignRow = Awaited<ReturnType<typeof loadCampaignRows>>[number];
type Guardrails = ReturnType<typeof getApprovalConfig>["guardrails"];

/** Budget action for one campaign: request a change, or show that one is already pending. */
function CampaignAction({ row, guardrails, i18n, block }: { row: CampaignRow; guardrails: Guardrails; i18n: ServerI18n; block?: boolean }) {
  const { campaign, hasOpenBudgetRequest } = row;
  if (campaign.status === "ARCHIVED") return null;
  if (hasOpenBudgetRequest) {
    return (
      <Badge tone="warning" icon={<Clock aria-hidden className="size-3" />}>
        {i18n.dict.metaAds.pendingApproval}
      </Badge>
    );
  }
  return (
    <BudgetChangeDialog
      campaign={{ id: campaign.id, name: campaign.name, currency: campaign.currency, dailyBudgetMinor: campaign.dailyBudgetMinor }}
      guardrails={guardrails}
      block={block}
    />
  );
}

const DAYS = 30;

export async function generateMetadata({ params }: PageProps<"/[lang]/meta-ads">): Promise<Metadata> {
  return { title: getI18n((await params).lang).dict.metaAds.title };
}

export default async function MetaAdsPage({ params }: PageProps<"/[lang]/meta-ads">) {
  const i18n = getI18n((await params).lang);
  return (
    <>
      <PageHeader title={i18n.dict.metaAds.title} description={i18n.dict.metaAds.notice} />
      <Suspense fallback={<SectionSkeleton label={i18n.dict.common.loading} />}>
        <MetaAdsContent i18n={i18n} />
      </Suspense>
    </>
  );
}

async function MetaAdsContent({ i18n }: { i18n: ServerI18n }) {
  await connection();
  const now = new Date();
  const { dict, fmt, t } = i18n;
  const perf = await loadPerformance(DAYS, now);
  const rows = await loadCampaignRows(perf.range);
  const { guardrails } = getApprovalConfig();
  const currency = perf.account.currency;
  const pct = (f: number) => fmt.percent(f, { signed: true });
  const vs = t(dict.common.vsPrevious, { n: DAYS });
  const c = dict.metaAds.columns;

  return (
    <div className="space-y-5 sm:space-y-6">
      <p className="text-sm text-ink-2">{richT(dict.metaAds.subtitle, { account: perf.account.name })}</p>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label={dict.kpi.adSpend}
          value={fmt.currency(perf.kpis.spend.value, currency, { compact: true })}
          delta={deltaOf(perf.kpis.spend.delta, pct)}
          deltaLabel={vs}
          upIsGood={null}
          trend={perf.trends.spend}
        />
        <StatTile
          label={dict.kpi.roas}
          hint={dict.kpi.roasHint}
          value={fmt.roas(perf.kpis.metaRoas.value)}
          delta={deltaOf(perf.kpis.metaRoas.delta, pct)}
          deltaLabel={vs}
          trend={perf.trends.metaRoas}
        />
        <StatTile label={dict.kpi.purchases} value={fmt.number(perf.adTotals.purchases)} trend={perf.trends.purchases} />
        <StatTile
          label={dict.kpi.ctr}
          value={perf.adTotals.impressions ? fmt.percent(perf.adTotals.clicks / perf.adTotals.impressions, { digits: 2 }) : "—"}
          trend={perf.trends.ctr}
        />
      </div>

      <Card>
        <CardHeader title={dict.metaAds.campaigns} description={t(dict.common.lastNDays, { n: DAYS })} />
        <DataList label={dict.metaAds.campaigns} className="mt-2">
          {rows.map((row) => {
            const { campaign, metrics, derived } = row;
            return (
              <DataListItem
                key={campaign.id}
                title={campaign.name}
                subtitle={dict.metaAds.objective[campaign.objective]}
                aside={
                  <Badge tone={campaign.status === "ACTIVE" ? "good" : "neutral"}>{dict.metaAds.campaignStatus[campaign.status]}</Badge>
                }
                footer={<CampaignAction row={row} guardrails={guardrails} i18n={i18n} block />}
              >
                <MetricGrid
                  items={[
                    { label: c.dailyBudget, value: fmt.currency(campaign.dailyBudgetMinor, campaign.currency) },
                    { label: c.spend, value: fmt.currency(metrics.spendMinor, campaign.currency) },
                    {
                      label: c.roas,
                      value: fmt.roas(derived.roas),
                      className: derived.roas !== null && derived.roas < 1 ? "text-critical-ink" : undefined,
                    },
                    { label: c.ctr, value: derived.ctr === null ? "—" : fmt.percent(derived.ctr, { digits: 2 }) },
                    { label: c.purchases, value: fmt.number(metrics.purchases) },
                    { label: c.cpa, value: derived.cpaMinor === null ? "—" : fmt.currency(derived.cpaMinor, campaign.currency) },
                  ]}
                />
              </DataListItem>
            );
          })}
        </DataList>
        <div className="hidden pt-4 md:block">
          <TableContainer label={dict.metaAds.campaigns} stickyFirstColumn>
            <thead>
              <tr>
                <Th>{c.campaign}</Th>
                <Th>{c.status}</Th>
                <Th numeric>{c.dailyBudget}</Th>
                <Th numeric>{c.spend}</Th>
                <Th numeric>{c.roas}</Th>
                <Th numeric>{c.ctr}</Th>
                <Th numeric>{c.purchases}</Th>
                <Th numeric>{c.cpa}</Th>
                <Th>
                  <span className="sr-only">{dict.common.actions}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { campaign, metrics, derived } = row;
                return (
                  <tr key={campaign.id}>
                    <Td className="min-w-48 lg:min-w-56">
                      <p className="font-medium">{campaign.name}</p>
                      <p className="text-xs text-ink-2">{dict.metaAds.objective[campaign.objective]}</p>
                    </Td>
                    <Td>
                      <Badge tone={campaign.status === "ACTIVE" ? "good" : "neutral"}>
                        {dict.metaAds.campaignStatus[campaign.status]}
                      </Badge>
                    </Td>
                    <Td numeric>{fmt.currency(campaign.dailyBudgetMinor, campaign.currency)}</Td>
                    <Td numeric>{fmt.currency(metrics.spendMinor, campaign.currency)}</Td>
                    <Td numeric>
                      <span className={derived.roas !== null && derived.roas < 1 ? "text-critical-ink" : undefined}>
                        {fmt.roas(derived.roas)}
                      </span>
                    </Td>
                    <Td numeric>{derived.ctr === null ? "—" : fmt.percent(derived.ctr, { digits: 2 })}</Td>
                    <Td numeric>{fmt.number(metrics.purchases)}</Td>
                    <Td numeric>{derived.cpaMinor === null ? "—" : fmt.currency(derived.cpaMinor, campaign.currency)}</Td>
                    <Td className="text-end">
                      <CampaignAction row={row} guardrails={guardrails} i18n={i18n} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableContainer>
        </div>
      </Card>

      <Card>
        <CardHeader title={dict.charts.roasTrend} description={dict.charts.roasTrendDesc} />
        <CardBody>
          <TimeSeriesChart
            title={dict.charts.roasTrend}
            dates={perf.ads.map((d) => d.date)}
            format={{ kind: "roas" }}
            reference={{ value: 1, label: dict.charts.breakEven }}
            series={[
              {
                id: "roas",
                label: dict.charts.series.roas,
                color: "series-1",
                values: perf.ads.map((d) => (d.spendMinor ? Math.round((d.purchaseValueMinor / d.spendMinor) * 100) / 100 : 0)),
              },
            ]}
          />
        </CardBody>
      </Card>

      <Notice tone="safety">{dict.metaAds.budgetDialog.notice}</Notice>
    </div>
  );
}

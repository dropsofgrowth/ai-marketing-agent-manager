import { Clock } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { BudgetChangeDialog } from "@/components/approvals/budget-change-dialog";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionSkeleton } from "@/components/ui/skeleton";
import { StatTile, deltaOf } from "@/components/ui/stat-tile";
import { TableContainer, Td, Th } from "@/components/ui/table";
import { richT } from "@/i18n/rich";
import { getI18n, type ServerI18n } from "@/i18n/server";
import { getApprovalConfig } from "@/server/services";
import { loadCampaignRows, loadPerformance } from "@/server/queries/performance";

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
    <div className="space-y-6">
      <p className="text-sm text-ink-2">{richT(dict.metaAds.subtitle, { account: perf.account.name })}</p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={dict.kpi.adSpend}
          value={fmt.currency(perf.kpis.spend.value, currency, { compact: true })}
          delta={deltaOf(perf.kpis.spend.delta, pct)}
          deltaLabel={vs}
          upIsGood={null}
        />
        <StatTile
          label={dict.kpi.roas}
          hint={dict.kpi.roasHint}
          value={fmt.roas(perf.kpis.metaRoas.value)}
          delta={deltaOf(perf.kpis.metaRoas.delta, pct)}
          deltaLabel={vs}
        />
        <StatTile label={dict.kpi.purchases} value={fmt.number(perf.adTotals.purchases)} />
        <StatTile
          label={dict.kpi.ctr}
          value={perf.adTotals.impressions ? fmt.percent(perf.adTotals.clicks / perf.adTotals.impressions, { digits: 2 }) : "—"}
        />
      </div>

      <Card>
        <CardHeader title={dict.metaAds.campaigns} description={t(dict.common.lastNDays, { n: DAYS })} />
        <div className="pt-4">
          <TableContainer label={dict.metaAds.campaigns}>
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
              {rows.map(({ campaign, metrics, derived, hasOpenBudgetRequest }) => (
                <tr key={campaign.id} className="hover:bg-surface-2/60">
                  <Td className="min-w-56">
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
                    {campaign.status === "ARCHIVED" ? null : hasOpenBudgetRequest ? (
                      <Badge tone="warning" icon={<Clock aria-hidden className="size-3" />}>
                        {dict.metaAds.pendingApproval}
                      </Badge>
                    ) : (
                      <BudgetChangeDialog
                        campaign={{
                          id: campaign.id,
                          name: campaign.name,
                          currency: campaign.currency,
                          dailyBudgetMinor: campaign.dailyBudgetMinor,
                        }}
                        guardrails={guardrails}
                      />
                    )}
                  </Td>
                </tr>
              ))}
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

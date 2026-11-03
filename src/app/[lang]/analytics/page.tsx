import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { BarList } from "@/components/charts/bar-list";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataList, DataListItem, MetricGrid } from "@/components/ui/data-list";
import { PageHeader } from "@/components/ui/page-header";
import { SectionSkeleton } from "@/components/ui/skeleton";
import { StatTile, deltaOf } from "@/components/ui/stat-tile";
import { TableContainer, Td, Th } from "@/components/ui/table";
import { getI18n, type ServerI18n } from "@/i18n/server";
import { cn } from "@/lib/cn";
import { RANGE_OPTIONS, loadCampaignRows, loadPerformance, parseRange } from "@/server/queries/performance";

export async function generateMetadata({ params }: PageProps<"/[lang]/analytics">): Promise<Metadata> {
  return { title: getI18n((await params).lang).dict.analytics.title };
}

export default async function AnalyticsPage({ params, searchParams }: PageProps<"/[lang]/analytics">) {
  const i18n = getI18n((await params).lang);
  return (
    <>
      <PageHeader title={i18n.dict.analytics.title} description={i18n.dict.analytics.subtitle} />
      <Suspense fallback={<SectionSkeleton label={i18n.dict.common.loading} />}>
        <AnalyticsContent i18n={i18n} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function AnalyticsContent({
  i18n,
  searchParams,
}: {
  i18n: ServerI18n;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const days = parseRange((await searchParams).range);
  const now = new Date();
  const { dict, fmt, t, locale } = i18n;
  const perf = await loadPerformance(days, now);
  const rows = await loadCampaignRows(perf.range);
  const currency = perf.account.currency;
  const pct = (f: number) => fmt.percent(f, { signed: true });
  const vs = t(dict.common.vsPrevious, { n: days });
  const c = dict.metaAds.columns;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* One filter row above everything it scopes. */}
      <nav aria-label={dict.analytics.range} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {RANGE_OPTIONS.map((option) => {
          const selected = option === days;
          return (
            <Link
              key={option}
              href={`/${locale}/analytics?range=${option}`}
              aria-current={selected ? "true" : undefined}
              scroll={false}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border px-3 text-[13px] whitespace-nowrap pointer-coarse:h-10",
                selected ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line-strong text-ink-2 hover:bg-surface-2",
              )}
            >
              {selected ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : null}
              {t(dict.analytics.rangeOption, { n: option })}
            </Link>
          );
        })}
      </nav>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label={dict.kpi.revenue} value={fmt.currency(perf.kpis.revenue.value, currency, { compact: true })} delta={deltaOf(perf.kpis.revenue.delta, pct)} deltaLabel={vs} trend={perf.trends.revenue} />
        <StatTile label={dict.kpi.adSpend} value={fmt.currency(perf.kpis.spend.value, currency, { compact: true })} delta={deltaOf(perf.kpis.spend.delta, pct)} deltaLabel={vs} upIsGood={null} trend={perf.trends.spend} />
        <StatTile label={dict.kpi.blendedRoas} hint={dict.kpi.blendedRoasHint} value={fmt.roas(perf.kpis.blendedRoas.value)} delta={deltaOf(perf.kpis.blendedRoas.delta, pct)} deltaLabel={vs} trend={perf.trends.blendedRoas} />
        <StatTile label={dict.kpi.roas} hint={dict.kpi.roasHint} value={fmt.roas(perf.kpis.metaRoas.value)} delta={deltaOf(perf.kpis.metaRoas.delta, pct)} deltaLabel={vs} trend={perf.trends.metaRoas} />
      </div>

      <Card>
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
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
        <Card>
          <CardHeader title={dict.charts.spendByCampaign} description={dict.charts.spendByCampaignDesc} />
          <CardBody>
            <BarList
              label={dict.charts.spendByCampaign}
              items={[...rows]
                .sort((a, b) => b.metrics.spendMinor - a.metrics.spendMinor)
                .map((r) => ({
                  id: r.campaign.id,
                  label: r.campaign.name,
                  value: r.metrics.spendMinor,
                  display: fmt.currency(r.metrics.spendMinor, r.campaign.currency),
                  note: perf.adTotals.spendMinor ? fmt.percent(r.metrics.spendMinor / perf.adTotals.spendMinor, { digits: 0 }) : undefined,
                }))}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={dict.analytics.campaignBreakdown} description={t(dict.common.lastNDays, { n: days })} />
        <DataList label={dict.analytics.campaignBreakdown} className="mt-2">
          {rows.map(({ campaign, metrics, derived }) => (
            <DataListItem
              key={campaign.id}
              title={campaign.name}
              aside={<span className="tabular text-sm font-semibold text-ink">{fmt.roas(derived.roas)}</span>}
            >
              <MetricGrid
                items={[
                  { label: c.spend, value: fmt.currency(metrics.spendMinor, campaign.currency) },
                  { label: dict.kpi.impressions, value: fmt.number(metrics.impressions, { compact: true }) },
                  { label: dict.kpi.clicks, value: fmt.number(metrics.clicks) },
                  { label: c.ctr, value: derived.ctr === null ? "—" : fmt.percent(derived.ctr, { digits: 2 }) },
                  { label: dict.kpi.cpc, value: derived.cpcMinor === null ? "—" : fmt.currency(Math.round(derived.cpcMinor), campaign.currency) },
                  { label: c.purchases, value: fmt.number(metrics.purchases) },
                  { label: c.cpa, value: derived.cpaMinor === null ? "—" : fmt.currency(Math.round(derived.cpaMinor), campaign.currency) },
                ]}
              />
            </DataListItem>
          ))}
        </DataList>
        <div className="hidden pt-4 md:block">
          <TableContainer label={dict.analytics.campaignBreakdown} stickyFirstColumn>
            <thead>
              <tr>
                <Th>{c.campaign}</Th>
                <Th numeric>{c.spend}</Th>
                <Th numeric>{dict.kpi.impressions}</Th>
                <Th numeric>{dict.kpi.clicks}</Th>
                <Th numeric>{c.ctr}</Th>
                <Th numeric>{dict.kpi.cpc}</Th>
                <Th numeric>{c.purchases}</Th>
                <Th numeric>{c.cpa}</Th>
                <Th numeric>{c.roas}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ campaign, metrics, derived }) => (
                <tr key={campaign.id}>
                  <Td className="min-w-48 font-medium lg:min-w-56">{campaign.name}</Td>
                  <Td numeric>{fmt.currency(metrics.spendMinor, campaign.currency)}</Td>
                  <Td numeric>{fmt.number(metrics.impressions)}</Td>
                  <Td numeric>{fmt.number(metrics.clicks)}</Td>
                  <Td numeric>{derived.ctr === null ? "—" : fmt.percent(derived.ctr, { digits: 2 })}</Td>
                  <Td numeric>{derived.cpcMinor === null ? "—" : fmt.currency(Math.round(derived.cpcMinor), campaign.currency)}</Td>
                  <Td numeric>{fmt.number(metrics.purchases)}</Td>
                  <Td numeric>{derived.cpaMinor === null ? "—" : fmt.currency(Math.round(derived.cpaMinor), campaign.currency)}</Td>
                  <Td numeric>{fmt.roas(derived.roas)}</Td>
                </tr>
              ))}
            </tbody>
          </TableContainer>
        </div>
      </Card>
    </div>
  );
}

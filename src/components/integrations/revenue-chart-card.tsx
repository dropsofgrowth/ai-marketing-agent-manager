import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { ServerI18n } from "@/i18n/server";
import type { Performance } from "@/server/queries/performance";

/**
 * "Revenue vs. ad spend" only when both series are comparable (same kind of
 * source, same currency). Otherwise store revenue alone, in the store's currency,
 * so live revenue is never plotted against demo ad spend.
 */
export function RevenueChartCard({ perf, i18n, className }: { perf: Performance; i18n: ServerI18n; className?: string }) {
  const { dict } = i18n;

  if (perf.comparable) {
    return (
      <Card className={className}>
        <CardHeader title={dict.charts.revenueVsSpend} description={dict.charts.revenueVsSpendDesc} />
        <CardBody>
          <TimeSeriesChart
            title={dict.charts.revenueVsSpend}
            dates={perf.sales.map((d) => d.date)}
            format={{ kind: "currency", currency: perf.account.currency }}
            series={[
              { id: "revenue", label: dict.charts.series.revenue, color: "series-1", values: perf.sales.map((d) => d.revenueMinor) },
              { id: "spend", label: dict.charts.series.spend, color: "series-2", values: perf.ads.map((d) => d.spendMinor) },
            ]}
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader title={dict.charts.storeRevenue} description={dict.charts.storeRevenueDesc} />
      <CardBody>
        {perf.shop ? (
          <TimeSeriesChart
            title={dict.charts.storeRevenue}
            dates={perf.sales.map((d) => d.date)}
            format={{ kind: "currency", currency: perf.shop.currency }}
            series={[
              { id: "revenue", label: dict.charts.series.revenue, color: "series-1", values: perf.sales.map((d) => d.revenueMinor) },
            ]}
          />
        ) : (
          <p className="text-sm text-ink-2">{dict.dataSource.errorNotice}</p>
        )}
      </CardBody>
    </Card>
  );
}

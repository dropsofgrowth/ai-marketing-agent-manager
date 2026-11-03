import "server-only";

import { OPEN_APPROVAL_STATUSES } from "@/domain/approvals/state-machine";
import { getIntegrations } from "@/integrations/registry";
import { previousRange, trailingRange, type DateRange } from "@/lib/dates";
import { averageOf, bucketSeries, deriveMetrics, pooledRatioOf, relativeDelta, sumMetrics } from "@/lib/metrics";
import { getCurrentActor } from "@/server/auth/actor";
import { getStore } from "@/server/store";

export const RANGE_OPTIONS = [7, 14, 30, 90] as const;
export type RangeDays = (typeof RANGE_OPTIONS)[number];

/** Points per KPI sparkline (see bucketSeries). */
const TREND_POINTS = 15;

export function parseRange(value: string | string[] | undefined, fallback: RangeDays = 30): RangeDays {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (RANGE_OPTIONS as readonly number[]).includes(n) ? (n as RangeDays) : fallback;
}

/** Store + ads performance for a trailing window, with the previous window for deltas. */
export async function loadPerformance(days: number, now: Date) {
  const { metaAds, shopify } = getIntegrations();
  const range = trailingRange(days, now);
  const prev = previousRange(range);

  const [account, shop, ads, adsPrev, sales, salesPrev] = await Promise.all([
    metaAds.getAdAccount(),
    shopify.getShop(),
    metaAds.getDailyInsights(range),
    metaAds.getDailyInsights(prev),
    shopify.getDailySales(range),
    shopify.getDailySales(prev),
  ]);

  const sumSales = (rows: typeof sales) =>
    rows.reduce(
      (t, r) => ({ orders: t.orders + r.orders, revenueMinor: t.revenueMinor + r.revenueMinor, sessions: t.sessions + r.sessions }),
      { orders: 0, revenueMinor: 0, sessions: 0 },
    );

  const adTotals = sumMetrics(ads);
  const adPrevTotals = sumMetrics(adsPrev);
  const salesTotals = sumSales(sales);
  const salesPrevTotals = sumSales(salesPrev);
  const blended = (revenue: number, spend: number) => (spend > 0 ? revenue / spend : null);

  // One row per day with store and ad metrics joined on the date (for sparklines).
  const adsByDate = new Map(ads.map((row) => [row.date, row]));
  const daily = sales.map((s) => ({ ...s, ad: adsByDate.get(s.date) }));
  type Day = (typeof daily)[number];
  const trend = (reduce: (run: readonly Day[]) => number | null) =>
    bucketSeries(daily, TREND_POINTS, reduce).map((v) => v ?? Number.NaN);
  const spendOf = (d: Day) => d.ad?.spendMinor ?? 0;

  return {
    range,
    account,
    shop,
    ads,
    sales,
    adTotals,
    salesTotals,
    /** Sparkline series (oldest first); NaN marks a point without data. */
    trends: {
      revenue: trend(averageOf((d) => d.revenueMinor)),
      spend: trend(averageOf(spendOf)),
      orders: trend(averageOf((d) => d.orders)),
      purchases: trend(averageOf((d) => d.ad?.purchases ?? 0)),
      blendedRoas: trend(pooledRatioOf((d) => d.revenueMinor, spendOf)),
      metaRoas: trend(pooledRatioOf((d) => d.ad?.purchaseValueMinor ?? 0, spendOf)),
      aov: trend(pooledRatioOf((d) => d.revenueMinor, (d) => d.orders)),
      conversionRate: trend(pooledRatioOf((d) => d.orders, (d) => d.sessions)),
      ctr: trend(pooledRatioOf((d) => d.ad?.clicks ?? 0, (d) => d.ad?.impressions ?? 0)),
    },
    kpis: {
      revenue: { value: salesTotals.revenueMinor, delta: relativeDelta(salesTotals.revenueMinor, salesPrevTotals.revenueMinor) },
      spend: { value: adTotals.spendMinor, delta: relativeDelta(adTotals.spendMinor, adPrevTotals.spendMinor) },
      blendedRoas: {
        value: blended(salesTotals.revenueMinor, adTotals.spendMinor),
        delta: relativeDelta(
          blended(salesTotals.revenueMinor, adTotals.spendMinor),
          blended(salesPrevTotals.revenueMinor, adPrevTotals.spendMinor),
        ),
      },
      metaRoas: {
        value: deriveMetrics(adTotals).roas,
        delta: relativeDelta(deriveMetrics(adTotals).roas, deriveMetrics(adPrevTotals).roas),
      },
      orders: { value: salesTotals.orders, delta: relativeDelta(salesTotals.orders, salesPrevTotals.orders) },
      aov: {
        value: salesTotals.orders ? salesTotals.revenueMinor / salesTotals.orders : null,
        delta: relativeDelta(
          salesTotals.orders ? salesTotals.revenueMinor / salesTotals.orders : null,
          salesPrevTotals.orders ? salesPrevTotals.revenueMinor / salesPrevTotals.orders : null,
        ),
      },
      conversionRate: {
        value: salesTotals.sessions ? salesTotals.orders / salesTotals.sessions : null,
        delta: relativeDelta(
          salesTotals.sessions ? salesTotals.orders / salesTotals.sessions : null,
          salesPrevTotals.sessions ? salesPrevTotals.orders / salesPrevTotals.sessions : null,
        ),
      },
    },
  };
}

export type Performance = Awaited<ReturnType<typeof loadPerformance>>;

/** Campaigns with totals for `range` and whether a budget request is already open. */
export async function loadCampaignRows(range: DateRange) {
  const { metaAds } = getIntegrations();
  const actor = await getCurrentActor();
  const [campaigns, insights, open] = await Promise.all([
    metaAds.listCampaigns(),
    metaAds.getCampaignInsights(range),
    getStore().approvals.list(actor.workspaceId, { statuses: OPEN_APPROVAL_STATUSES }),
  ]);
  const openBudgetTargets = new Set(open.filter((a) => a.type === "BUDGET_CHANGE").map((a) => a.targetExternalId));

  return campaigns.map((campaign) => {
    const metrics = insights.find((i) => i.campaignId === campaign.id)?.metrics ?? sumMetrics([]);
    return { campaign, metrics, derived: deriveMetrics(metrics), hasOpenBudgetRequest: openBudgetTargets.has(campaign.id) };
  });
}

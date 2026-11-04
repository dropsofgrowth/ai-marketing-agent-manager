import "server-only";

import { OPEN_APPROVAL_STATUSES } from "@/domain/approvals/state-machine";
import type { DomainErrorCode } from "@/domain/errors";
import { getIntegrations } from "@/integrations/registry";
import type { DailySales, ShopifyCapabilities, ShopifyShop } from "@/integrations/shopify/types";
import { previousRange, trailingRange, type DateRange } from "@/lib/dates";
import { averageOf, bucketSeries, deriveMetrics, pooledRatioOf, relativeDelta, sumMetrics } from "@/lib/metrics";
import { getCurrentActor } from "@/server/auth/actor";
import { getShopifySource, toShopifyErrorCode } from "@/server/integrations/shopify";
import { log } from "@/server/logging";
import { getStore } from "@/server/store";

export const RANGE_OPTIONS = [7, 14, 30, 90] as const;
export type RangeDays = (typeof RANGE_OPTIONS)[number];

/** Points per KPI sparkline (see bucketSeries). */
const TREND_POINTS = 15;

export function parseRange(value: string | string[] | undefined, fallback: RangeDays = 30): RangeDays {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (RANGE_OPTIONS as readonly number[]).includes(n) ? (n as RangeDays) : fallback;
}

/** Where the store figures on a page come from — always shown to the user. */
export type StoreSourceInfo =
  | { mode: "demo"; reason: "not_configured" | "storage_required" | "not_connected" }
  | { mode: "live"; shopName: string; shopDomain: string }
  | { mode: "error"; code: DomainErrorCode; shopDomain: string | null };

export type DataMode = "demo" | "live";

type Day<T> = { date: string } & T;
const nanSeries = () => Array.from({ length: TREND_POINTS }, () => Number.NaN);

/** Meta Ads delivery for a trailing window (+ the previous window for deltas). Never touches Shopify. */
export async function loadAdPerformance(days: number, now: Date) {
  const { metaAds } = getIntegrations();
  const range = trailingRange(days, now);
  const prev = previousRange(range);
  const [account, ads, adsPrev] = await Promise.all([
    metaAds.getAdAccount(),
    metaAds.getDailyInsights(range),
    metaAds.getDailyInsights(prev),
  ]);
  const adTotals = sumMetrics(ads);
  const adPrevTotals = sumMetrics(adsPrev);
  type AdDay = (typeof ads)[number];
  const trend = (reduce: (run: readonly AdDay[]) => number | null) =>
    bucketSeries(ads, TREND_POINTS, reduce).map((v) => v ?? Number.NaN);

  return {
    range,
    prev,
    account,
    ads,
    adTotals,
    adPrevTotals,
    adsMode: (metaAds.info.mode === "live" ? "live" : "demo") as DataMode,
    trends: {
      spend: trend(averageOf((d) => d.spendMinor)),
      purchases: trend(averageOf((d) => d.purchases)),
      metaRoas: trend(pooledRatioOf((d) => d.purchaseValueMinor, (d) => d.spendMinor)),
      ctr: trend(pooledRatioOf((d) => d.clicks, (d) => d.impressions)),
    },
    kpis: {
      spend: { value: adTotals.spendMinor, delta: relativeDelta(adTotals.spendMinor, adPrevTotals.spendMinor) },
      metaRoas: {
        value: deriveMetrics(adTotals).roas,
        delta: relativeDelta(deriveMetrics(adTotals).roas, deriveMetrics(adPrevTotals).roas),
      },
    },
  };
}

export type AdPerformance = Awaited<ReturnType<typeof loadAdPerformance>>;

type StoreData = {
  source: StoreSourceInfo;
  shop: ShopifyShop | null;
  capabilities: ShopifyCapabilities | null;
  sales: DailySales[];
  salesPrev: DailySales[];
  /** False when Shopify returned only part of the current window. */
  complete: boolean;
  prevComplete: boolean;
};

/** Store (Shopify) daily sales for two windows. Live failures become an error state — never demo data. */
async function loadStore(range: DateRange, prev: DateRange): Promise<StoreData> {
  const source = await getShopifySource();
  const empty = { shop: null, capabilities: null, sales: [], salesPrev: [], complete: false, prevComplete: false };
  if (source.mode === "error") {
    return { source: { mode: "error", code: source.code, shopDomain: source.shopDomain }, ...empty };
  }
  try {
    const [shop, window, windowPrev] = await Promise.all([
      source.service.getShop(),
      source.service.getDailySales(range),
      source.service.getDailySales(prev),
    ]);
    return {
      source:
        source.mode === "live"
          ? { mode: "live", shopName: shop.name, shopDomain: source.shopDomain }
          : { mode: "demo", reason: source.reason },
      shop,
      capabilities: source.service.capabilities,
      sales: window.days,
      salesPrev: windowPrev.days,
      complete: window.complete,
      prevComplete: windowPrev.complete,
    };
  } catch (error) {
    const code = toShopifyErrorCode(error);
    log("warn", "shopify.store_data_unavailable", { errorCode: code });
    return {
      source: { mode: "error", code, shopDomain: source.mode === "live" ? source.shopDomain : null },
      ...empty,
    };
  }
}

const sumSales = (rows: readonly DailySales[]) =>
  rows.reduce(
    (t, r) => ({
      orders: t.orders + r.orders,
      revenueMinor: t.revenueMinor + r.revenueMinor,
      sessions: t.sessions === null || r.sessions === null ? null : t.sessions + r.sessions,
    }),
    { orders: 0, revenueMinor: 0, sessions: 0 as number | null },
  );

/** Store + ads performance for a trailing window, with the previous window for deltas. */
export async function loadPerformance(days: number, now: Date) {
  const ad = await loadAdPerformance(days, now);
  const store = await loadStore(ad.range, ad.prev);
  const hasStore = store.shop !== null;
  const storeMode: DataMode | null = store.source.mode === "error" ? null : store.source.mode;

  // Store revenue and ad spend may only be combined when both are real (or both
  // demo) and in the same currency — never real revenue over sample ad spend.
  const comparable = hasStore && storeMode === ad.adsMode && store.shop?.currency === ad.account.currency;

  const totals = sumSales(store.sales);
  const prevTotals = sumSales(store.salesPrev);
  const delta = (current: number | null, previous: number | null) =>
    store.prevComplete && store.complete ? relativeDelta(current, previous) : null;
  const blended = (revenue: number, spend: number) => (spend > 0 ? revenue / spend : null);
  const aov = (t: typeof totals) => (t.orders ? t.revenueMinor / t.orders : null);
  const conversion = (t: typeof totals) => (t.sessions ? t.orders / t.sessions : null);

  const adsByDate = new Map(ad.ads.map((row) => [row.date, row]));
  const daily = store.sales.map((s) => ({ ...s, ad: adsByDate.get(s.date) }));
  type JoinedDay = Day<(typeof daily)[number]>;
  const trend = (reduce: (run: readonly JoinedDay[]) => number | null) =>
    hasStore ? bucketSeries(daily, TREND_POINTS, reduce).map((v) => v ?? Number.NaN) : nanSeries();
  const spendOf = (d: JoinedDay) => d.ad?.spendMinor ?? 0;

  return {
    ...ad,
    shop: store.shop,
    sales: store.sales,
    salesTotals: totals,
    store: {
      source: store.source,
      capabilities: store.capabilities,
      complete: store.complete,
      prevComplete: store.prevComplete,
    },
    /** Blended metrics (store revenue ÷ ad spend) are meaningful. */
    comparable,
    trends: {
      ...ad.trends,
      revenue: trend(averageOf((d) => d.revenueMinor)),
      orders: trend(averageOf((d) => d.orders)),
      aov: trend(pooledRatioOf((d) => d.revenueMinor, (d) => d.orders)),
      conversionRate: trend(pooledRatioOf((d) => d.orders, (d) => d.sessions ?? 0)),
      blendedRoas: comparable ? trend(pooledRatioOf((d) => d.revenueMinor, spendOf)) : nanSeries(),
    },
    kpis: {
      ...ad.kpis,
      revenue: { value: hasStore ? totals.revenueMinor : null, delta: delta(totals.revenueMinor, prevTotals.revenueMinor) },
      orders: { value: hasStore ? totals.orders : null, delta: delta(totals.orders, prevTotals.orders) },
      aov: { value: aov(totals), delta: delta(aov(totals), aov(prevTotals)) },
      conversionRate: { value: conversion(totals), delta: delta(conversion(totals), conversion(prevTotals)) },
      blendedRoas: comparable
        ? {
            value: blended(totals.revenueMinor, ad.adTotals.spendMinor),
            delta: delta(blended(totals.revenueMinor, ad.adTotals.spendMinor), blended(prevTotals.revenueMinor, ad.adPrevTotals.spendMinor)),
          }
        : { value: null, delta: null },
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

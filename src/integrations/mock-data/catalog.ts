/**
 * Deterministic sample data shared by the mock adapters. Every value is derived
 * from a seeded PRNG keyed by (entity, date), so the same date range always
 * returns the same numbers — across restarts, servers and tests.
 */
import type {
  AdMetrics,
  DailyAdMetrics,
  MetaCampaign,
} from "@/integrations/meta-ads/types";
import type { DailySales, ShopifyProduct } from "@/integrations/shopify/types";
import { eachDay, parseIsoDate, type DateRange } from "@/lib/dates";

import { seededRandom } from "./random";

export const MOCK_CURRENCY = "USD";

export const MOCK_AD_ACCOUNT = {
  id: "act_000000000000001",
  name: "Demo Store — Ad Account (mock)",
  currency: MOCK_CURRENCY,
  timezone: "UTC",
} as const;

export const MOCK_SHOP = {
  domain: "demo-store.myshopify.com",
  name: "Demo Store (mock)",
  currency: MOCK_CURRENCY,
  timezone: "UTC",
} as const;

type CampaignProfile = MetaCampaign & {
  /** Typical return on ad spend. */
  roas: number;
  /** Typical click-through rate (0–1). */
  ctr: number;
  /** Typical cost per 1,000 impressions, major units. */
  cpm: number;
};

const CAMPAIGN_PROFILES: readonly CampaignProfile[] = [
  {
    id: "120210000000000001",
    name: "New Arrivals — Advantage+ Shopping",
    status: "ACTIVE",
    objective: "SALES",
    dailyBudgetMinor: 300_00,
    currency: MOCK_CURRENCY,
    startDate: "2026-06-01",
    roas: 3.6,
    ctr: 0.0165,
    cpm: 11.5,
  },
  {
    id: "120210000000000002",
    name: "Retargeting — Cart Abandoners",
    status: "ACTIVE",
    objective: "SALES",
    dailyBudgetMinor: 120_00,
    currency: MOCK_CURRENCY,
    startDate: "2026-05-12",
    roas: 4.4,
    ctr: 0.021,
    cpm: 14,
  },
  {
    id: "120210000000000003",
    name: "Summer Collection — Prospecting",
    status: "ACTIVE",
    objective: "SALES",
    dailyBudgetMinor: 250_00,
    currency: MOCK_CURRENCY,
    startDate: "2026-07-01",
    roas: 2.1,
    ctr: 0.012,
    cpm: 9.5,
  },
  {
    id: "120210000000000004",
    name: "Gift Guide — Lookalike 2%",
    status: "ACTIVE",
    objective: "SALES",
    dailyBudgetMinor: 180_00,
    currency: MOCK_CURRENCY,
    startDate: "2026-09-15",
    roas: 0.85,
    ctr: 0.009,
    cpm: 10.5,
  },
  {
    id: "120210000000000005",
    name: "Brand Awareness — Video",
    status: "ACTIVE",
    objective: "AWARENESS",
    dailyBudgetMinor: 90_00,
    currency: MOCK_CURRENCY,
    startDate: "2026-04-20",
    roas: 0.4,
    ctr: 0.006,
    cpm: 5.5,
  },
  {
    id: "120210000000000006",
    name: "Clearance — Broad",
    status: "PAUSED",
    objective: "SALES",
    dailyBudgetMinor: 60_00,
    currency: MOCK_CURRENCY,
    startDate: "2026-03-02",
    roas: 0.9,
    ctr: 0.008,
    cpm: 8,
  },
];

export function mockCampaigns(): MetaCampaign[] {
  return CAMPAIGN_PROFILES.map(({ roas: _r, ctr: _c, cpm: _m, ...campaign }) => ({ ...campaign }));
}

function weekdayFactor(isoDate: string): number {
  const day = parseIsoDate(isoDate).getUTCDay();
  // Fridays and Saturdays convert slightly better in the sample data.
  return day === 5 || day === 6 ? 1.08 : 1;
}

function emptyMetrics(): AdMetrics {
  return { spendMinor: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValueMinor: 0 };
}

export function campaignMetricsForDay(campaignId: string, isoDate: string): AdMetrics {
  const profile = CAMPAIGN_PROFILES.find((c) => c.id === campaignId);
  if (!profile || profile.status !== "ACTIVE" || isoDate < profile.startDate) return emptyMetrics();

  const rand = seededRandom(`meta:${campaignId}:${isoDate}`);
  const spendMinor = Math.round(profile.dailyBudgetMinor * (0.86 + rand() * 0.14));
  const cpm = profile.cpm * (0.9 + rand() * 0.2);
  const impressions = Math.round((spendMinor / 100 / cpm) * 1000);
  const clicks = Math.round(impressions * profile.ctr * (0.85 + rand() * 0.3));
  const roas = profile.roas * (0.75 + rand() * 0.5) * weekdayFactor(isoDate);
  const purchaseValueMinor = Math.round(spendMinor * roas);
  const averageOrderValue = 65 + rand() * 20;
  const purchases = Math.round(purchaseValueMinor / 100 / averageOrderValue);

  return { spendMinor, impressions, clicks, purchases, purchaseValueMinor };
}

export function addMetrics(a: AdMetrics, b: AdMetrics): AdMetrics {
  return {
    spendMinor: a.spendMinor + b.spendMinor,
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    purchases: a.purchases + b.purchases,
    purchaseValueMinor: a.purchaseValueMinor + b.purchaseValueMinor,
  };
}

export function accountMetricsForDay(isoDate: string): AdMetrics {
  return CAMPAIGN_PROFILES.reduce(
    (total, c) => addMetrics(total, campaignMetricsForDay(c.id, isoDate)),
    emptyMetrics(),
  );
}

export function dailyAdMetrics(range: DateRange, campaignId?: string): DailyAdMetrics[] {
  return eachDay(range).map((date) => ({
    date,
    ...(campaignId ? campaignMetricsForDay(campaignId, date) : accountMetricsForDay(date)),
  }));
}

export function campaignTotals(campaignId: string, range: DateRange): AdMetrics {
  return eachDay(range).reduce(
    (total, date) => addMetrics(total, campaignMetricsForDay(campaignId, date)),
    emptyMetrics(),
  );
}

// --- Store ---------------------------------------------------------------------

const PRODUCTS: readonly ShopifyProduct[] = [
  { id: "gid://shopify/Product/1001", title: "Linen Overshirt", status: "ACTIVE", priceMinor: 89_00, currency: MOCK_CURRENCY, inventory: 142, swatchHue: 32 },
  { id: "gid://shopify/Product/1002", title: "Everyday Canvas Tote", status: "ACTIVE", priceMinor: 45_00, currency: MOCK_CURRENCY, inventory: 318, swatchHue: 48 },
  { id: "gid://shopify/Product/1003", title: "Cloud Runner Sneakers", status: "ACTIVE", priceMinor: 129_00, currency: MOCK_CURRENCY, inventory: 7, swatchHue: 210 },
  { id: "gid://shopify/Product/1004", title: "Silk Square Scarf", status: "ACTIVE", priceMinor: 65_00, currency: MOCK_CURRENCY, inventory: 54, swatchHue: 340 },
  { id: "gid://shopify/Product/1005", title: "Ceramic Pour-Over Set", status: "ACTIVE", priceMinor: 58_00, currency: MOCK_CURRENCY, inventory: 4, swatchHue: 18 },
  { id: "gid://shopify/Product/1006", title: "Merino Crew Sweater", status: "ACTIVE", priceMinor: 110_00, currency: MOCK_CURRENCY, inventory: 63, swatchHue: 150 },
  { id: "gid://shopify/Product/1007", title: "Leather Card Holder", status: "ACTIVE", priceMinor: 39_00, currency: MOCK_CURRENCY, inventory: 205, swatchHue: 24 },
  { id: "gid://shopify/Product/1008", title: "Oud & Amber Candle", status: "DRAFT", priceMinor: 48_00, currency: MOCK_CURRENCY, inventory: 0, swatchHue: 280 },
];

/** Relative popularity used to split daily revenue across products. */
const PRODUCT_WEIGHTS: Record<string, number> = {
  "gid://shopify/Product/1001": 0.18,
  "gid://shopify/Product/1002": 0.12,
  "gid://shopify/Product/1003": 0.24,
  "gid://shopify/Product/1004": 0.09,
  "gid://shopify/Product/1005": 0.08,
  "gid://shopify/Product/1006": 0.19,
  "gid://shopify/Product/1007": 0.1,
  "gid://shopify/Product/1008": 0,
};

export function mockProducts(): ShopifyProduct[] {
  return PRODUCTS.map((p) => ({ ...p }));
}

export function productWeight(productId: string): number {
  return PRODUCT_WEIGHTS[productId] ?? 0;
}

export function dailySalesForDay(isoDate: string): DailySales {
  const rand = seededRandom(`shop:${isoDate}`);
  const adAttributedMinor = accountMetricsForDay(isoDate).purchaseValueMinor;
  const organicMinor = Math.round((900 + rand() * 500) * 100 * weekdayFactor(isoDate));
  // Meta's attribution overlaps partially with other channels, hence 0.92.
  const revenueMinor = Math.round(adAttributedMinor * 0.92 + organicMinor);
  const averageOrderValue = 72 + rand() * 10;
  const orders = Math.max(1, Math.round(revenueMinor / 100 / averageOrderValue));
  const sessions = Math.round(orders / (0.022 + rand() * 0.008));
  return { date: isoDate, orders, revenueMinor, sessions };
}

export function dailySales(range: DateRange): DailySales[] {
  return eachDay(range).map(dailySalesForDay);
}

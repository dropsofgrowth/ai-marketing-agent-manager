import type { DateRange, IntegrationInfo } from "@/integrations/types";

export type ShopifyShop = {
  domain: string;
  name: string;
  currency: string;
  /** IANA time zone of the store; daily figures are bucketed in it. */
  timezone: string;
};

export type ShopifyProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

export type ShopifyProduct = {
  id: string;
  title: string;
  status: ShopifyProductStatus;
  /** Lowest variant price. */
  priceMinor: number;
  currency: string;
  /** Null when inventory isn't tracked or the app lacks `read_inventory`. */
  inventory: number | null;
  /** Hue (0–360) for the thumbnail swatch. */
  swatchHue: number;
};

export type ProductPerformance = {
  productId: string;
  unitsSold: number;
  revenueMinor: number;
};

export type ProductPerformanceResult = {
  rows: ProductPerformance[];
  /** Orders the figures are based on. */
  ordersScanned: number;
  /** False when only the most recent orders of the period could be read. */
  complete: boolean;
};

export type OrderSource = "meta" | "direct" | "search" | "email";

export const FINANCIAL_STATUSES = [
  "PAID",
  "PENDING",
  "AUTHORIZED",
  "PARTIALLY_PAID",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "VOIDED",
  "EXPIRED",
] as const;
export type FinancialStatus = (typeof FINANCIAL_STATUSES)[number];

export type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  /** Null when customer names are not available (protected customer data). */
  customerLabel: string | null;
  totalMinor: number;
  currency: string;
  financialStatus: FinancialStatus;
  fulfillmentStatus: "FULFILLED" | "UNFULFILLED" | "PARTIAL";
  itemCount: number;
  /** Null when the marketing source is unknown. */
  source: OrderSource | null;
  test: boolean;
};

export type DailySales = {
  date: string;
  orders: number;
  revenueMinor: number;
  /** Null when sessions aren't available (needs Shopify analytics access). */
  sessions: number | null;
};

export type SalesWindow = {
  days: DailySales[];
  /**
   * False when Shopify could only return part of the range — e.g. orders older
   * than 60 days without `read_all_orders`, or the safety cap on pages was hit.
   */
  complete: boolean;
};

/** What this adapter can provide. Pages hide or explain metrics that aren't available. */
export type ShopifyCapabilities = {
  sessions: boolean;
  customerNames: boolean;
  orderSources: boolean;
  inventory: boolean;
  /** How far back orders can be read; null = full history. */
  orderHistoryDays: number | null;
};

/**
 * Shopify Admin API contract. Read-only by design: there are deliberately no
 * methods that change products, prices, inventory or orders.
 */
export interface ShopifyService {
  readonly info: IntegrationInfo;
  readonly capabilities: ShopifyCapabilities;

  getShop(): Promise<ShopifyShop>;
  getDailySales(range: DateRange): Promise<SalesWindow>;
  listProducts(): Promise<ShopifyProduct[]>;
  getProductPerformance(range: DateRange): Promise<ProductPerformanceResult>;
  listRecentOrders(limit: number, now: Date): Promise<ShopifyOrder[]>;
}

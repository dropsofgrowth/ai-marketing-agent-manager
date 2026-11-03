import type { DateRange, IntegrationInfo } from "@/integrations/types";

export type ShopifyShop = {
  domain: string;
  name: string;
  currency: string;
};

export type ShopifyProduct = {
  id: string;
  title: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  priceMinor: number;
  currency: string;
  inventory: number;
  /** Hue (0–360) for the mock thumbnail swatch. */
  swatchHue: number;
};

export type ProductPerformance = {
  productId: string;
  unitsSold: number;
  revenueMinor: number;
};

export type OrderSource = "meta" | "direct" | "search" | "email";

export type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  customerLabel: string;
  totalMinor: number;
  currency: string;
  financialStatus: "PAID" | "PENDING" | "REFUNDED";
  fulfillmentStatus: "FULFILLED" | "UNFULFILLED" | "PARTIAL";
  itemCount: number;
  source: OrderSource;
};

export type DailySales = {
  date: string;
  orders: number;
  revenueMinor: number;
  sessions: number;
};

/**
 * Shopify Admin API contract. Phase 1 is read-only: there are deliberately no
 * methods that change products, prices, inventory or orders.
 */
export interface ShopifyService {
  readonly info: IntegrationInfo;

  getShop(): Promise<ShopifyShop>;
  getDailySales(range: DateRange): Promise<DailySales[]>;
  listProducts(): Promise<ShopifyProduct[]>;
  getProductPerformance(range: DateRange): Promise<ProductPerformance[]>;
  listRecentOrders(limit: number, now: Date): Promise<ShopifyOrder[]>;
}

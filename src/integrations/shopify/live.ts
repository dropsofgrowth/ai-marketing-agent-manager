import { z } from "zod";

import { decimalToMinor } from "@/domain/money";
import { hashString } from "@/integrations/mock-data/random";
import type { ShopifyGraphqlClient } from "@/integrations/shopify/graphql-client";
import { assessScopes } from "@/integrations/shopify/oauth";
import type {
  DailySales,
  FinancialStatus,
  ProductPerformanceResult,
  SalesWindow,
  ShopifyCapabilities,
  ShopifyOrder,
  ShopifyProduct,
  ShopifyProductStatus,
  ShopifyService,
  ShopifyShop,
} from "@/integrations/shopify/types";
import { FINANCIAL_STATUSES } from "@/integrations/shopify/types";
import type { DateRange, IntegrationInfo } from "@/integrations/types";
import { addDays, eachDay } from "@/lib/dates";
import { isValidTimeZone, startOfZonedDay, zonedIsoDate } from "@/lib/timezone";
import type { TtlCache } from "@/lib/ttl-cache";

/**
 * Live, read-only Shopify adapter (GraphQL Admin API).
 *
 * Every document below is a `query`; the client refuses anything else. Customer
 * fields (names, emails, addresses) are deliberately never requested: they are
 * protected customer data and the dashboard doesn't need them.
 */

// --- Documents ------------------------------------------------------------------

export const SHOP_QUERY = /* GraphQL */ `
  query ShopInfo {
    shop { name myshopifyDomain currencyCode ianaTimezone }
  }
`;

/** Also reports the scopes the installation actually holds (used by "Verify connection"). */
export const VERIFY_QUERY = /* GraphQL */ `
  query VerifyConnection {
    shop { name myshopifyDomain currencyCode ianaTimezone }
    currentAppInstallation { accessScopes { handle } }
  }
`;

const productsQuery = (withInventory: boolean) => /* GraphQL */ `
  query Products($first: Int!) {
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage }
      nodes {
        id
        title
        status
        ${withInventory ? "totalInventory\n        tracksInventory" : ""}
        priceRangeV2 { minVariantPrice { amount currencyCode } }
      }
    }
  }
`;

export const RECENT_ORDERS_QUERY = /* GraphQL */ `
  query RecentOrders($first: Int!) {
    orders(first: $first, sortKey: PROCESSED_AT, reverse: true) {
      nodes {
        id
        name
        processedAt
        test
        displayFinancialStatus
        displayFulfillmentStatus
        currentSubtotalLineItemsQuantity
        currentTotalPriceSet { shopMoney { amount currencyCode } }
      }
    }
  }
`;

export const ORDER_TOTALS_QUERY = /* GraphQL */ `
  query OrderTotals($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        processedAt
        test
        cancelledAt
        currentTotalPriceSet { shopMoney { amount currencyCode } }
      }
    }
  }
`;

/** Requested cost ≈ 30 orders × 24 points ≈ 720, well under Shopify's 1,000-point single-query limit. */
export const ORDER_LINE_ITEMS_QUERY = /* GraphQL */ `
  query OrderLineItems($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        test
        cancelledAt
        lineItems(first: 5) {
          pageInfo { hasNextPage }
          nodes {
            quantity
            product { id }
            discountedTotalSet { shopMoney { amount currencyCode } }
          }
        }
      }
    }
  }
`;

// --- Response schemas (validated: a surprise shape fails loudly, never renders garbage) ---

const money = z.object({ shopMoney: z.object({ amount: z.string(), currencyCode: z.string() }) });
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable().optional() });

const shopSchema = z.object({
  shop: z.object({ name: z.string(), myshopifyDomain: z.string(), currencyCode: z.string(), ianaTimezone: z.string() }),
});
const verifySchema = shopSchema.extend({
  currentAppInstallation: z.object({ accessScopes: z.array(z.object({ handle: z.string() })) }),
});
const productsSchema = z.object({
  products: z.object({
    pageInfo,
    nodes: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        totalInventory: z.number().nullable().optional(),
        tracksInventory: z.boolean().nullable().optional(),
        priceRangeV2: z.object({ minVariantPrice: z.object({ amount: z.string(), currencyCode: z.string() }) }),
      }),
    ),
  }),
});
const recentOrdersSchema = z.object({
  orders: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        processedAt: z.string(),
        test: z.boolean(),
        displayFinancialStatus: z.string().nullable(),
        displayFulfillmentStatus: z.string().nullable(),
        currentSubtotalLineItemsQuantity: z.number(),
        currentTotalPriceSet: money,
      }),
    ),
  }),
});
const orderTotalsSchema = z.object({
  orders: z.object({
    pageInfo,
    nodes: z.array(
      z.object({ processedAt: z.string(), test: z.boolean(), cancelledAt: z.string().nullable(), currentTotalPriceSet: money }),
    ),
  }),
});
const lineItemsSchema = z.object({
  orders: z.object({
    pageInfo,
    nodes: z.array(
      z.object({
        test: z.boolean(),
        cancelledAt: z.string().nullable(),
        lineItems: z.object({
          pageInfo: z.object({ hasNextPage: z.boolean() }),
          nodes: z.array(
            z.object({ quantity: z.number(), product: z.object({ id: z.string() }).nullable(), discountedTotalSet: money }),
          ),
        }),
      }),
    ),
  }),
});

// --- Mapping helpers ------------------------------------------------------------

export function mapProductStatus(status: string): ShopifyProductStatus {
  // Unknown future statuses are shown as Draft rather than misreported as Active.
  return status === "ACTIVE" || status === "ARCHIVED" ? status : "DRAFT";
}

export function mapFinancialStatus(status: string | null): FinancialStatus {
  return (FINANCIAL_STATUSES as readonly string[]).includes(status ?? "") ? (status as FinancialStatus) : "PENDING";
}

export function mapFulfillmentStatus(status: string | null): ShopifyOrder["fulfillmentStatus"] {
  if (status === "FULFILLED") return "FULFILLED";
  if (status === "PARTIALLY_FULFILLED") return "PARTIAL";
  return "UNFULFILLED";
}

/** Shopify search syntax for a half-open processed_at window, in UTC. */
export function processedAtFilter(start: Date, end: Date): string {
  return `processed_at:>='${start.toISOString()}' AND processed_at:<'${end.toISOString()}'`;
}

// --- Service --------------------------------------------------------------------

/** Safety caps so one page view can't drain the store's API budget. */
export const LIMITS = {
  products: 250,
  totalsPageSize: 250,
  totalsMaxPages: 20, // 5,000 orders per window
  lineItemsPageSize: 30,
  lineItemsMaxPages: 14, // 420 most recent orders per window
  ttl: { shop: 10 * 60_000, sales: 5 * 60_000, products: 5 * 60_000, orders: 60_000 },
} as const;

export class LiveShopifyService implements ShopifyService {
  readonly info: IntegrationInfo = { provider: "SHOPIFY", mode: "live" };
  readonly capabilities: ShopifyCapabilities;

  private readonly client: ShopifyGraphqlClient;
  private readonly cache: TtlCache;
  private readonly cacheKey: string;
  private readonly now: () => Date;

  constructor(options: {
    client: ShopifyGraphqlClient;
    /** Granted scopes of the stored connection. */
    scopes: readonly string[];
    cache: TtlCache;
    /** Unique per connection (changes on reconnect) so cached data never crosses stores. */
    cacheKey: string;
    now?: () => Date;
  }) {
    const scopes = assessScopes(options.scopes);
    this.client = options.client;
    this.cache = options.cache;
    this.cacheKey = options.cacheKey;
    this.now = options.now ?? (() => new Date());
    this.capabilities = {
      sessions: false,
      customerNames: false,
      orderSources: false,
      inventory: scopes.hasInventory,
      orderHistoryDays: scopes.hasAllOrders ? null : 60,
    };
  }

  private cached<T>(name: string, ttl: number, load: () => Promise<T>) {
    return this.cache.get(`${this.cacheKey}:${name}`, ttl, load);
  }

  getShop(): Promise<ShopifyShop> {
    return this.cached("shop", LIMITS.ttl.shop, async () => {
      const data = shopSchema.parse(await this.client.query("ShopInfo", SHOP_QUERY));
      return {
        domain: data.shop.myshopifyDomain,
        name: data.shop.name,
        currency: data.shop.currencyCode,
        timezone: isValidTimeZone(data.shop.ianaTimezone) ? data.shop.ianaTimezone : "UTC",
      };
    });
  }

  /** True when every day of `range` lies inside the readable order history. */
  private historyCovers(range: DateRange, timeZone: string): boolean {
    const days = this.capabilities.orderHistoryDays;
    if (days === null) return true;
    const earliest = addDays(zonedIsoDate(this.now(), timeZone), -(days - 1));
    return range.from >= earliest;
  }

  getDailySales(range: DateRange): Promise<SalesWindow> {
    return this.cached(`sales:${range.from}:${range.to}`, LIMITS.ttl.sales, async () => {
      const shop = await this.getShop();
      const tz = shop.timezone;
      const query = processedAtFilter(startOfZonedDay(range.from, tz), startOfZonedDay(addDays(range.to, 1), tz));
      const byDay = new Map<string, DailySales>(
        eachDay(range).map((date) => [date, { date, orders: 0, revenueMinor: 0, sessions: null }]),
      );

      let after: string | null = null;
      let truncated = false;
      let foreignCurrency = false;
      for (let page = 0; ; page++) {
        if (page >= LIMITS.totalsMaxPages) {
          truncated = true;
          break;
        }
        const data = orderTotalsSchema.parse(
          await this.client.query("OrderTotals", ORDER_TOTALS_QUERY, { first: LIMITS.totalsPageSize, after, query }),
        );
        for (const order of data.orders.nodes) {
          if (order.test || order.cancelledAt) continue;
          const day = byDay.get(zonedIsoDate(new Date(order.processedAt), tz));
          if (!day) continue;
          const { amount, currencyCode } = order.currentTotalPriceSet.shopMoney;
          if (currencyCode !== shop.currency) {
            foreignCurrency = true;
            continue;
          }
          day.orders += 1;
          day.revenueMinor += decimalToMinor(amount, currencyCode);
        }
        if (!data.orders.pageInfo.hasNextPage) break;
        after = data.orders.pageInfo.endCursor ?? null;
        if (!after) break;
      }

      return {
        days: [...byDay.values()],
        complete: !truncated && !foreignCurrency && this.historyCovers(range, tz),
      };
    });
  }

  listProducts(): Promise<ShopifyProduct[]> {
    return this.cached("products", LIMITS.ttl.products, async () => {
      const withInventory = this.capabilities.inventory;
      const data = productsSchema.parse(
        await this.client.query("Products", productsQuery(withInventory), { first: LIMITS.products }),
      );
      return data.products.nodes.map((node) => {
        const price = node.priceRangeV2.minVariantPrice;
        const tracked = withInventory && node.tracksInventory !== false && typeof node.totalInventory === "number";
        return {
          id: node.id,
          title: node.title,
          status: mapProductStatus(node.status),
          priceMinor: decimalToMinor(price.amount, price.currencyCode),
          currency: price.currencyCode,
          inventory: tracked ? (node.totalInventory as number) : null,
          swatchHue: hashString(node.id) % 360,
        };
      });
    });
  }

  getProductPerformance(range: DateRange): Promise<ProductPerformanceResult> {
    return this.cached(`products-perf:${range.from}:${range.to}`, LIMITS.ttl.sales, async () => {
      const shop = await this.getShop();
      const tz = shop.timezone;
      const query = processedAtFilter(startOfZonedDay(range.from, tz), startOfZonedDay(addDays(range.to, 1), tz));
      const totals = new Map<string, { unitsSold: number; revenueMinor: number }>();

      let after: string | null = null;
      let complete = this.historyCovers(range, tz);
      let ordersScanned = 0;
      for (let page = 0; ; page++) {
        if (page >= LIMITS.lineItemsMaxPages) {
          complete = false;
          break;
        }
        const data = lineItemsSchema.parse(
          await this.client.query("OrderLineItems", ORDER_LINE_ITEMS_QUERY, {
            first: LIMITS.lineItemsPageSize,
            after,
            query,
          }),
        );
        for (const order of data.orders.nodes) {
          if (order.test || order.cancelledAt) continue;
          ordersScanned += 1;
          if (order.lineItems.pageInfo.hasNextPage) complete = false;
          for (const item of order.lineItems.nodes) {
            if (!item.product) continue; // custom/deleted products
            const { amount, currencyCode } = item.discountedTotalSet.shopMoney;
            if (currencyCode !== shop.currency) {
              complete = false;
              continue;
            }
            const row = totals.get(item.product.id) ?? { unitsSold: 0, revenueMinor: 0 };
            row.unitsSold += item.quantity;
            row.revenueMinor += decimalToMinor(amount, currencyCode);
            totals.set(item.product.id, row);
          }
        }
        if (!data.orders.pageInfo.hasNextPage) break;
        after = data.orders.pageInfo.endCursor ?? null;
        if (!after) break;
      }

      return {
        rows: [...totals.entries()].map(([productId, t]) => ({ productId, ...t })),
        ordersScanned,
        complete,
      };
    });
  }

  listRecentOrders(limit: number): Promise<ShopifyOrder[]> {
    const first = Math.min(Math.max(1, Math.floor(limit)), 50);
    return this.cached(`orders:${first}`, LIMITS.ttl.orders, async () => {
      const data = recentOrdersSchema.parse(await this.client.query("RecentOrders", RECENT_ORDERS_QUERY, { first }));
      return data.orders.nodes.map((order) => {
        const { amount, currencyCode } = order.currentTotalPriceSet.shopMoney;
        return {
          id: order.id,
          name: order.name,
          createdAt: order.processedAt,
          customerLabel: null,
          totalMinor: decimalToMinor(amount, currencyCode),
          currency: currencyCode,
          financialStatus: mapFinancialStatus(order.displayFinancialStatus),
          fulfillmentStatus: mapFulfillmentStatus(order.displayFulfillmentStatus),
          itemCount: order.currentSubtotalLineItemsQuantity,
          source: null,
          test: order.test,
        };
      });
    });
  }
}

/** Parses the verification query (shop identity + granted scopes). */
export async function runVerificationQuery(client: ShopifyGraphqlClient) {
  const data = verifySchema.parse(await client.query("VerifyConnection", VERIFY_QUERY));
  return {
    shop: {
      domain: data.shop.myshopifyDomain.toLowerCase(),
      name: data.shop.name,
      currency: data.shop.currencyCode,
      timezone: data.shop.ianaTimezone,
    },
    scopes: data.currentAppInstallation.accessScopes.map((s) => s.handle).sort(),
  };
}

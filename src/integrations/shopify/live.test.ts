import { describe, expect, it } from "vitest";

import { decimalToMinor } from "@/domain/money";
import { createShopifyGraphqlClient } from "@/integrations/shopify/graphql-client";
import { LiveShopifyService, processedAtFilter } from "@/integrations/shopify/live";
import { startOfZonedDay, zonedIsoDate } from "@/lib/timezone";
import { createTtlCache } from "@/lib/ttl-cache";
import { createMemoryLogger } from "@/server/logging";

import { createFakeShopify } from "../../../test/fake-shopify";

const NOW = new Date("2026-11-04T10:00:00Z");
const SHOP = "drops-of-growth.myshopify.com";
const VERSION = "2026-10";

function setup(options: { scopes?: string[]; timezone?: string; currency?: string } = {}) {
  const fake = createFakeShopify({
    shop: SHOP,
    clientId: "id",
    clientSecret: "secret",
    apiVersion: VERSION,
    timezone: options.timezone ?? "Asia/Dubai",
    currency: options.currency ?? "AED",
    now: () => NOW,
  });
  fake.state.accessTokens.set("shpat_test", Number.POSITIVE_INFINITY);
  const client = createShopifyGraphqlClient({
    shop: SHOP,
    apiVersion: VERSION,
    fetchImpl: fake.fetchImpl,
    logger: createMemoryLogger(),
    getAccessToken: async () => "shpat_test",
    sleep: async () => {},
  });
  const service = new LiveShopifyService({
    client,
    scopes: options.scopes ?? ["read_orders", "read_products"],
    cache: createTtlCache(),
    cacheKey: "test",
    now: () => NOW,
  });
  return { fake, service };
}

describe("money and time helpers", () => {
  it("converts decimal strings to minor units exactly", () => {
    expect(decimalToMinor("89.95", "USD")).toBe(8995);
    expect(decimalToMinor("0.1", "USD")).toBe(10);
    expect(decimalToMinor("1.005", "USD")).toBe(101); // half up, no float error
    expect(decimalToMinor("1500", "JPY")).toBe(1500);
    expect(decimalToMinor("12.345", "KWD")).toBe(12345);
    expect(() => decimalToMinor("1e3", "USD")).toThrow();
  });

  it("finds local midnight and local dates in the store's time zone", () => {
    expect(startOfZonedDay("2026-11-04", "Asia/Dubai").toISOString()).toBe("2026-11-03T20:00:00.000Z");
    expect(startOfZonedDay("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(startOfZonedDay("2026-03-09", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z"); // after DST
    expect(zonedIsoDate(new Date("2026-11-03T21:30:00Z"), "Asia/Dubai")).toBe("2026-11-04");
  });
});

describe("live Shopify adapter (read-only)", () => {
  it("only ever sends query documents", async () => {
    const { fake, service } = setup();
    await service.getShop();
    await service.listProducts();
    await service.listRecentOrders(5);
    await service.getDailySales({ from: "2026-11-01", to: "2026-11-03" });
    await service.getProductPerformance({ from: "2026-11-01", to: "2026-11-03" });
    expect(fake.state.graphqlRequests.map((r) => r.operation)).toEqual([
      "ShopInfo",
      "Products",
      "RecentOrders",
      "OrderTotals",
      "OrderLineItems",
    ]);
  });

  it("buckets daily sales by the store's local day, excluding test and cancelled orders", async () => {
    const { fake, service } = setup();
    fake.state.orders = [
      { processedAt: "2026-11-01T19:30:00Z", total: "50.00" }, // 23:30 Dubai, Nov 1
      { processedAt: "2026-11-01T20:30:00Z", total: "100.25" }, // 00:30 Dubai, Nov 2
      { processedAt: "2026-11-02T10:00:00Z", total: "20.00", test: true },
      { processedAt: "2026-11-02T11:00:00Z", total: "30.00", cancelled: true },
      { processedAt: "2026-10-31T19:59:00Z", total: "999.00" }, // Oct 31 local — outside range
    ];
    const window = await service.getDailySales({ from: "2026-11-01", to: "2026-11-02" });
    expect(window.days).toEqual([
      { date: "2026-11-01", orders: 1, revenueMinor: 5000, sessions: null },
      { date: "2026-11-02", orders: 1, revenueMinor: 10025, sessions: null },
    ]);
    expect(window.complete).toBe(true);
    expect(fake.state.graphqlRequests.at(-1)?.variables.query).toBe(
      processedAtFilter(new Date("2026-10-31T20:00:00Z"), new Date("2026-11-02T20:00:00Z")),
    );
  });

  it("follows pagination and caches results", async () => {
    const { fake, service } = setup({ timezone: "UTC" });
    fake.state.orders = Array.from({ length: 260 }, (_, i) => ({
      processedAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
      total: "1.00",
    }));
    const window = await service.getDailySales({ from: "2026-11-01", to: "2026-11-01" });
    expect(window.days[0].orders).toBe(260);
    expect(fake.state.graphqlRequests.filter((r) => r.operation === "OrderTotals")).toHaveLength(2);
    await service.getDailySales({ from: "2026-11-01", to: "2026-11-01" });
    expect(fake.state.graphqlRequests.filter((r) => r.operation === "OrderTotals")).toHaveLength(2); // cached
  });

  it("marks windows older than 60 days incomplete without read_all_orders", async () => {
    const limited = setup();
    expect((await limited.service.getDailySales({ from: "2026-08-01", to: "2026-08-31" })).complete).toBe(false);
    const full = setup({ scopes: ["read_orders", "read_products", "read_all_orders"] });
    expect((await full.service.getDailySales({ from: "2026-08-01", to: "2026-08-31" })).complete).toBe(true);
    expect(full.service.capabilities.orderHistoryDays).toBeNull();
  });

  it("requests inventory only with read_inventory, and never shows untracked stock as zero", async () => {
    const products = [
      { id: "gid://shopify/Product/1", title: "Rose Oil", price: "120.00", totalInventory: 4 },
      { id: "gid://shopify/Product/2", title: "Gift Card", price: "50.00", totalInventory: 0, tracksInventory: false },
    ];
    const without = setup();
    without.fake.state.products = products;
    const listed = await without.service.listProducts();
    expect(listed.map((p) => p.inventory)).toEqual([null, null]);
    expect(listed[0]).toMatchObject({ title: "Rose Oil", priceMinor: 12000, currency: "AED", status: "ACTIVE" });

    const withInventory = setup({ scopes: ["read_orders", "read_products", "read_inventory"] });
    withInventory.fake.state.products = products;
    expect((await withInventory.service.listProducts()).map((p) => p.inventory)).toEqual([4, null]);
  });

  it("maps recent orders without any customer data", async () => {
    const { fake, service } = setup();
    fake.state.orders = [
      { processedAt: "2026-11-04T08:00:00Z", total: "75.50", financial: "PARTIALLY_REFUNDED", fulfillment: "PARTIALLY_FULFILLED", lineItems: [{ productId: "p", quantity: 2, total: "75.50" }] },
      { processedAt: "2026-11-03T08:00:00Z", total: "10.00", financial: null, fulfillment: "RESTOCKED", test: true },
    ];
    const orders = await service.listRecentOrders(10);
    expect(orders[0]).toMatchObject({
      totalMinor: 7550,
      financialStatus: "PARTIALLY_REFUNDED",
      fulfillmentStatus: "PARTIAL",
      itemCount: 2,
      customerLabel: null,
      source: null,
      test: false,
    });
    expect(orders[1]).toMatchObject({ financialStatus: "PENDING", fulfillmentStatus: "UNFULFILLED", test: true });
  });

  it("aggregates product performance from line items and flags truncation", async () => {
    const { fake, service } = setup({ timezone: "UTC" });
    fake.state.orders = [
      { processedAt: "2026-11-01T10:00:00Z", total: "0", lineItems: [{ productId: "gid://shopify/Product/1", quantity: 2, total: "40.00" }] },
      { processedAt: "2026-11-02T10:00:00Z", total: "0", lineItems: [{ productId: "gid://shopify/Product/1", quantity: 1, total: "20.00" }, { productId: null, quantity: 1, total: "5.00" }] },
      { processedAt: "2026-11-02T11:00:00Z", total: "0", test: true, lineItems: [{ productId: "gid://shopify/Product/1", quantity: 9, total: "180.00" }] },
    ];
    const result = await service.getProductPerformance({ from: "2026-11-01", to: "2026-11-02" });
    expect(result).toEqual({
      rows: [{ productId: "gid://shopify/Product/1", unitsSold: 3, revenueMinor: 6000 }],
      ordersScanned: 2,
      complete: true,
    });

    fake.state.orders.push({
      processedAt: "2026-11-02T12:00:00Z",
      total: "0",
      lineItems: Array.from({ length: 6 }, (_, i) => ({ productId: `gid://shopify/Product/${i}`, quantity: 1, total: "1.00" })),
    });
    const truncated = await service.getProductPerformance({ from: "2026-11-02", to: "2026-11-02" });
    expect(truncated.complete).toBe(false);
  });
});

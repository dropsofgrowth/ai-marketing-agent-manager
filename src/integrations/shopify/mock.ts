import {
  MOCK_CURRENCY,
  MOCK_SHOP,
  dailySales,
  mockProducts,
  productWeight,
} from "@/integrations/mock-data/catalog";
import { seededRandom } from "@/integrations/mock-data/random";
import type {
  DailySales,
  OrderSource,
  ProductPerformance,
  ShopifyOrder,
  ShopifyProduct,
  ShopifyService,
  ShopifyShop,
} from "@/integrations/shopify/types";
import type { DateRange, IntegrationInfo } from "@/integrations/types";

const CUSTOMER_LABELS = [
  "Layla H.",
  "Omar K.",
  "Sarah M.",
  "James R.",
  "Noor A.",
  "Yusuf B.",
  "Emma T.",
  "Hana S.",
  "Daniel P.",
  "Rania F.",
  "Karim D.",
  "Mia L.",
];

const SOURCES: OrderSource[] = ["meta", "meta", "meta", "direct", "search", "email"];

/** Deterministic, read-only Shopify adapter. Never performs network I/O. */
export class MockShopifyService implements ShopifyService {
  readonly info: IntegrationInfo = { provider: "SHOPIFY", mode: "mock" };

  async getShop(): Promise<ShopifyShop> {
    return { ...MOCK_SHOP };
  }

  async getDailySales(range: DateRange): Promise<DailySales[]> {
    return dailySales(range);
  }

  async listProducts(): Promise<ShopifyProduct[]> {
    return mockProducts();
  }

  async getProductPerformance(range: DateRange): Promise<ProductPerformance[]> {
    const totalRevenue = dailySales(range).reduce((sum, d) => sum + d.revenueMinor, 0);
    return mockProducts().map((product) => {
      const revenueMinor = Math.round(totalRevenue * productWeight(product.id));
      return {
        productId: product.id,
        revenueMinor,
        unitsSold: Math.round(revenueMinor / product.priceMinor),
      };
    });
  }

  async listRecentOrders(limit: number, now: Date): Promise<ShopifyOrder[]> {
    // Orders are keyed by the hour so the list is stable within an hour.
    const hourKey = Math.floor(now.getTime() / 3_600_000);
    const orders: ShopifyOrder[] = [];
    let timestamp = hourKey * 3_600_000;

    for (let i = 0; i < limit; i++) {
      const rand = seededRandom(`order:${hourKey - i}`);
      timestamp -= Math.round((20 + rand() * 140) * 60_000);
      const itemCount = 1 + Math.floor(rand() * 3);
      const financialRoll = rand();
      const fulfillmentRoll = rand();
      orders.push({
        id: `gid://shopify/Order/${5_000_000 + hourKey - i}`,
        name: `#${(hourKey - i) % 100_000}`,
        createdAt: new Date(timestamp).toISOString(),
        customerLabel: CUSTOMER_LABELS[Math.floor(rand() * CUSTOMER_LABELS.length)],
        totalMinor: Math.round((38 + rand() * 180) * 100) * itemCount,
        currency: MOCK_CURRENCY,
        financialStatus: financialRoll > 0.94 ? "REFUNDED" : financialRoll > 0.86 ? "PENDING" : "PAID",
        fulfillmentStatus: i < 3 || fulfillmentRoll > 0.7 ? "UNFULFILLED" : fulfillmentRoll > 0.6 ? "PARTIAL" : "FULFILLED",
        itemCount,
        source: SOURCES[Math.floor(rand() * SOURCES.length)],
      });
    }
    return orders;
  }
}

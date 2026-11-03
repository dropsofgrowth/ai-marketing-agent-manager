import "server-only";

import { MockHiggsfieldService } from "@/integrations/higgsfield/mock";
import type { HiggsfieldService } from "@/integrations/higgsfield/types";
import { MockMetaAdsService } from "@/integrations/meta-ads/mock";
import type { MetaAdsService } from "@/integrations/meta-ads/types";
import { MockShopifyService } from "@/integrations/shopify/mock";
import type { ShopifyService } from "@/integrations/shopify/types";

export type Integrations = {
  metaAds: MetaAdsService;
  shopify: ShopifyService;
  higgsfield: HiggsfieldService;
};

const globalForIntegrations = globalThis as unknown as { __integrations?: Integrations };

/**
 * Resolves the adapter for each provider.
 *
 * Phase 1: every provider resolves to its MOCK adapter, even when credentials are
 * present in the environment — live adapters have not been implemented or
 * reviewed yet. When they are, selection happens here, gated on validated
 * credentials and an explicit per-provider opt-in.
 */
export function getIntegrations(): Integrations {
  globalForIntegrations.__integrations ??= {
    metaAds: new MockMetaAdsService(),
    shopify: new MockShopifyService(),
    higgsfield: new MockHiggsfieldService(),
  };
  return globalForIntegrations.__integrations;
}

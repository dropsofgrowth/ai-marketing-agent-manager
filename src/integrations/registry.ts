import "server-only";

import { MockHiggsfieldService } from "@/integrations/higgsfield/mock";
import type { HiggsfieldService } from "@/integrations/higgsfield/types";
import { MockMetaAdsService } from "@/integrations/meta-ads/mock";
import type { MetaAdsService } from "@/integrations/meta-ads/types";

/**
 * Adapters that don't depend on a stored connection. Shopify is resolved per
 * workspace from its OAuth connection instead — see
 * `src/server/integrations/shopify` (`getShopifySource`).
 */
export type Integrations = {
  metaAds: MetaAdsService;
  higgsfield: HiggsfieldService;
};

const globalForIntegrations = globalThis as unknown as { __integrations?: Integrations };

/**
 * Resolves the adapter for each provider.
 *
 * Meta Ads and Higgsfield still resolve to their MOCK adapters, even when
 * credentials are present in the environment — their live adapters have not been
 * implemented or reviewed yet.
 */
export function getIntegrations(): Integrations {
  globalForIntegrations.__integrations ??= {
    metaAds: new MockMetaAdsService(),
    higgsfield: new MockHiggsfieldService(),
  };
  return globalForIntegrations.__integrations;
}

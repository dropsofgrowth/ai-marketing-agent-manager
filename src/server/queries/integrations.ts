import "server-only";

import type { IntegrationProviderId } from "@/domain/types";
import { getIntegrations } from "@/integrations/registry";
import type { IntegrationMode } from "@/integrations/types";
import { getIntegrationEnvStatus } from "@/server/env";
import { getShopifyConnectionView, type ShopifyConnectionView } from "@/server/integrations/shopify";

export type IntegrationStatus = {
  provider: IntegrationProviderId;
  mode: IntegrationMode;
  credentialsPresent: boolean;
  missing: string[];
  liveAdapterAvailable: boolean;
  /** Shopify only: OAuth connection state. */
  connection?: ShopifyConnectionView["state"];
};

/** Presence of credentials and connection state only — values are never read into the UI. */
export async function getIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const env = getIntegrationEnvStatus();
  const adapters = getIntegrations();
  const shopify = await getShopifyConnectionView();
  return [
    { provider: "META_ADS", mode: adapters.metaAds.info.mode, ...env.metaAds, liveAdapterAvailable: false },
    {
      provider: "SHOPIFY",
      mode: shopify.state === "connected" ? "live" : "mock",
      ...env.shopify,
      liveAdapterAvailable: true,
      connection: shopify.state,
    },
    { provider: "HIGGSFIELD", mode: adapters.higgsfield.info.mode, ...env.higgsfield, liveAdapterAvailable: false },
  ];
}

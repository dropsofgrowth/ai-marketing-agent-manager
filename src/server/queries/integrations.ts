import "server-only";

import type { IntegrationProviderId } from "@/domain/types";
import { getIntegrations } from "@/integrations/registry";
import type { IntegrationMode } from "@/integrations/types";
import { getIntegrationEnvStatus } from "@/server/env";

export type IntegrationStatus = {
  provider: IntegrationProviderId;
  mode: IntegrationMode;
  credentialsPresent: boolean;
  missing: string[];
  /** Phase 1: no live adapters exist, regardless of credentials. */
  liveAdapterAvailable: false;
};

/** Presence of credentials only — values are never read into the UI. */
export function getIntegrationStatuses(): IntegrationStatus[] {
  const env = getIntegrationEnvStatus();
  const adapters = getIntegrations();
  return [
    { provider: "META_ADS", mode: adapters.metaAds.info.mode, ...env.metaAds, liveAdapterAvailable: false },
    { provider: "SHOPIFY", mode: adapters.shopify.info.mode, ...env.shopify, liveAdapterAvailable: false },
    { provider: "HIGGSFIELD", mode: adapters.higgsfield.info.mode, ...env.higgsfield, liveAdapterAvailable: false },
  ];
}

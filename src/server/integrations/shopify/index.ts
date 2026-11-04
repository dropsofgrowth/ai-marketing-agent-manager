import "server-only";

import { cache } from "react";

import { createTtlCache, type TtlCache } from "@/lib/ttl-cache";
import { getCurrentActor } from "@/server/auth/actor";
import { getEnv } from "@/server/env";
import { log } from "@/server/logging";
import { getStore } from "@/server/store";

import { getShopifyReadiness } from "./config";
import { createShopifyConnectionService, type ShopifyConnectionService } from "./connection";

const globalForShopify = globalThis as unknown as {
  __shopifyService?: ShopifyConnectionService;
  __shopifyCache?: TtlCache;
};

/** One service per process (keeps the response cache and sync throttling across requests). */
export function getShopifyConnectionService(): ShopifyConnectionService {
  globalForShopify.__shopifyService ??= createShopifyConnectionService({
    store: getStore(),
    readiness: () => getShopifyReadiness(getEnv(), getStore().kind),
    // Resolve the global at call time so Next.js' instrumented fetch is used.
    fetchImpl: (input, init) => fetch(input, init),
    logger: log,
    now: () => new Date(),
    cache: (globalForShopify.__shopifyCache ??= createTtlCache()),
  });
  return globalForShopify.__shopifyService;
}

/** Shopify data source for the current request (deduplicated per render). */
export const getShopifySource = cache(async () => {
  const actor = await getCurrentActor();
  return getShopifyConnectionService().resolveSource(actor.workspaceId);
});

/** Connection status for the current workspace (deduplicated per render). */
export const getShopifyConnectionView = cache(async () => {
  const actor = await getCurrentActor();
  return getShopifyConnectionService().status(actor.workspaceId);
});

export { SHOPIFY_CALLBACK_PATH } from "./config";
export { SHOPIFY_STATE_COOKIE } from "./oauth-state";
export type { ShopifyConnectionView, ShopifySource } from "./connection";
export { toShopifyErrorCode } from "./connection";

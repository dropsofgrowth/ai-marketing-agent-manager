import "server-only";

import { SHOPIFY_REQUIRED_SCOPES } from "@/integrations/shopify/oauth";
import { DASHBOARD_AUTH_VARS } from "@/lib/basic-auth";
import { getDashboardAuth, type ServerEnv } from "@/server/env";
import { isValidEncryptionKey } from "@/server/security/encryption";
import type { StoreKind } from "@/server/store/types";

/** Route that receives Shopify's OAuth redirect. Must be listed as a redirect URL in the Dev Dashboard. */
export const SHOPIFY_CALLBACK_PATH = "/api/integrations/shopify/callback";

export type ShopifyAppConfig = {
  clientId: string;
  clientSecret: string;
  shopDomain: string;
  apiVersion: string;
  scopes: readonly string[];
  /** Absolute callback URL built from APP_URL — never from the request's Host header. */
  redirectUri: string;
  appUrl: string;
  encryptionKey: string;
  secureCookies: boolean;
};

export type ShopifyReadiness =
  | { ready: true; config: ShopifyAppConfig }
  | { ready: false; reason: "not_configured" | "storage_required"; missing: string[] }
  /** Live store data is never served without the dashboard password — in any environment. */
  | { ready: false; reason: "auth_required"; missing: string[] }
  | { ready: false; reason: "app_url_insecure"; missing: string[] };

function isLocalhost(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

/**
 * Decides whether a Shopify connection can be made, and reports only the NAMES of
 * missing settings (never values). A token is only ever stored encrypted in
 * PostgreSQL, so storage is a hard prerequisite, not an option.
 */
export function getShopifyReadiness(
  env: ServerEnv,
  storeKind: StoreKind,
  options: { requirePersistentStore?: boolean } = {},
): ShopifyReadiness {
  const requirePersistentStore = options.requirePersistentStore ?? true;

  const missingApp = (["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_STORE_DOMAIN"] as const).filter(
    (key) => !env[key],
  );
  if (missingApp.length) return { ready: false, reason: "not_configured", missing: [...missingApp] };

  if (getDashboardAuth(env).mode !== "required") {
    return { ready: false, reason: "auth_required", missing: [...DASHBOARD_AUTH_VARS] };
  }

  const missingStorage: string[] = [];
  if (requirePersistentStore && (!env.DATABASE_URL || storeKind !== "postgres")) missingStorage.push("DATABASE_URL");
  if (!isValidEncryptionKey(env.CREDENTIALS_ENCRYPTION_KEY)) missingStorage.push("CREDENTIALS_ENCRYPTION_KEY");
  if (missingStorage.length) return { ready: false, reason: "storage_required", missing: missingStorage };

  const appUrl = new URL(env.APP_URL);
  if (appUrl.protocol !== "https:" && !isLocalhost(appUrl)) {
    return { ready: false, reason: "app_url_insecure", missing: ["APP_URL"] };
  }
  const base = appUrl.origin;

  return {
    ready: true,
    config: {
      clientId: env.SHOPIFY_CLIENT_ID!,
      clientSecret: env.SHOPIFY_CLIENT_SECRET!,
      shopDomain: env.SHOPIFY_STORE_DOMAIN!,
      apiVersion: env.SHOPIFY_API_VERSION,
      scopes: SHOPIFY_REQUIRED_SCOPES,
      redirectUri: `${base}${SHOPIFY_CALLBACK_PATH}`,
      appUrl: base,
      encryptionKey: env.CREDENTIALS_ENCRYPTION_KEY!,
      secureCookies: appUrl.protocol === "https:",
    },
  };
}

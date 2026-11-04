/**
 * Outcomes of the Shopify OAuth callback, shown on the Settings page via
 * `?shopify=<code>`. The page only renders codes from this list.
 */
export const SHOPIFY_CONNECT_RESULTS = [
  "connected",
  "SHOPIFY_STATE_INVALID",
  "SHOPIFY_SIGNATURE_INVALID",
  "SHOPIFY_WRONG_STORE",
  "SHOPIFY_CONNECT_CANCELLED",
  "SHOPIFY_TOKEN_EXCHANGE_FAILED",
  "SHOPIFY_MISSING_SCOPES",
  "SHOPIFY_WRITE_SCOPES_GRANTED",
  "SHOPIFY_UNAVAILABLE",
  "SHOPIFY_NOT_CONFIGURED",
  "SHOPIFY_STORAGE_REQUIRED",
  "FORBIDDEN",
] as const;

export type ShopifyConnectResult = (typeof SHOPIFY_CONNECT_RESULTS)[number];

export function isShopifyConnectResult(value: unknown): value is ShopifyConnectResult {
  return typeof value === "string" && (SHOPIFY_CONNECT_RESULTS as readonly string[]).includes(value);
}

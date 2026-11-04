/**
 * Shopify OAuth — authorization code grant for a non-embedded app.
 *
 * Why this flow: the dashboard runs outside the Shopify admin, so token exchange
 * (embedded apps only) does not apply, and the client credentials grant only works
 * when the app and the store belong to the same Shopify organization. The
 * authorization code grant works for a custom-distribution app installed on any
 * store, so it is the supported path here.
 *
 * Tokens: we request an *expiring* offline token (`expiring=1`): a 1-hour access
 * token plus a 90-day refresh token. Refresh tokens rotate — Shopify invalidates
 * the previous one as soon as a new one is issued — so callers must persist the
 * newest refresh token before using the new access token (see the connection service).
 *
 * Nothing in this file logs or embeds token values in errors.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/** Phase 2 is read-only: exactly the scopes the installed app was granted. */
export const SHOPIFY_REQUIRED_SCOPES = ["read_orders", "read_products"] as const;
/** Read scopes the adapter uses when granted (more order history, inventory). Never required. */
export const SHOPIFY_OPTIONAL_SCOPES = ["read_all_orders", "read_inventory"] as const;

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** Returns the lower-cased `*.myshopify.com` domain, or null for anything else. */
export function normalizeShopDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const domain = value.trim().toLowerCase();
  return SHOP_DOMAIN.test(domain) ? domain : null;
}

export function buildAuthorizeUrl(input: {
  shop: string;
  clientId: string;
  scopes: readonly string[];
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(`https://${input.shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", input.scopes.join(","));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  // No `grant_options[]=per-user`: we want an offline (app-level) token, not one tied to a staff session.
  return url.toString();
}

function hmacMatches(message: string, secret: string, expected: Buffer): boolean {
  const digest = createHmac("sha256", secret).update(message, "utf8").digest();
  return digest.length === expected.length && timingSafeEqual(digest, expected);
}

/**
 * Verifies the `hmac` Shopify adds to the OAuth callback: hex HMAC-SHA256, keyed
 * with the client secret, over the remaining query parameters sorted by name and
 * joined as `name=value&…`. Compared in constant time. Both the form-encoded and
 * the raw join are accepted (official libraries differ in how they encode values);
 * either way the signature can only be produced with the client secret.
 */
export function verifyCallbackHmac(params: URLSearchParams, clientSecret: string): boolean {
  const provided = params.get("hmac");
  if (!provided || !/^[a-f0-9]{64}$/i.test(provided)) return false;

  const entries = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // Shopify never repeats a parameter; refuse to guess how to sign duplicates.
  if (new Set(entries.map(([key]) => key)).size !== entries.length) return false;

  const expected = Buffer.from(provided.toLowerCase(), "hex");
  const encoded = new URLSearchParams(entries).toString();
  const raw = entries.map(([key, value]) => `${key}=${value}`).join("&");
  const okEncoded = hmacMatches(encoded, clientSecret, expected);
  const okRaw = hmacMatches(raw, clientSecret, expected);
  return okEncoded || okRaw;
}

/** Rejects callbacks whose `timestamp` (seconds) is missing or outside ±toleranceSeconds. */
export function isFreshTimestamp(params: URLSearchParams, now: Date, toleranceSeconds = 300): boolean {
  const raw = params.get("timestamp");
  if (!raw || !/^\d{9,11}$/.test(raw)) return false;
  return Math.abs(now.getTime() / 1000 - Number(raw)) <= toleranceSeconds;
}

/** Constant-time string comparison (for `state`). */
export function safeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// --- Scopes -------------------------------------------------------------------

export function parseScopes(value: string | readonly string[] | null | undefined): string[] {
  const list = typeof value === "string" ? value.split(",") : [...(value ?? [])];
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))].sort();
}

export type ScopeAssessment = {
  missing: string[];
  /** Any write_* scope. Phase 2 refuses to store a token that can change the store. */
  write: string[];
  hasAllOrders: boolean;
  hasInventory: boolean;
};

export function assessScopes(granted: readonly string[]): ScopeAssessment {
  const set = new Set(granted);
  return {
    missing: SHOPIFY_REQUIRED_SCOPES.filter((scope) => !set.has(scope)),
    write: granted.filter((scope) => scope.startsWith("write_")),
    hasAllOrders: set.has("read_all_orders"),
    hasInventory: set.has("read_inventory"),
  };
}

// --- Token endpoint -------------------------------------------------------------

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  scope: z.string().optional(),
  expires_in: z.coerce.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.coerce.number().int().positive().optional(),
});

export type ShopifyTokenSet = {
  accessToken: string;
  /** Null when Shopify issued a non-expiring offline token. */
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
};

export function parseTokenResponse(json: unknown, now: Date): ShopifyTokenSet {
  const data = tokenResponseSchema.parse(json);
  const at = (seconds: number | undefined) => (seconds ? new Date(now.getTime() + seconds * 1000) : null);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    accessTokenExpiresAt: at(data.expires_in),
    refreshTokenExpiresAt: data.refresh_token ? at(data.refresh_token_expires_in) : null,
    scopes: parseScopes(data.scope),
  };
}

export type ShopifyOAuthFailure =
  /** Shopify refused the code/refresh token (invalid, expired, already used, app uninstalled). */
  | "rejected"
  /** Network error, timeout, redirect or 5xx — safe to retry later. */
  | "unavailable"
  /** 2xx with a body we don't understand. */
  | "bad_response";

export class ShopifyOAuthError extends Error {
  constructor(
    readonly reason: ShopifyOAuthFailure,
    readonly httpStatus: number | null,
  ) {
    super(`Shopify token request failed (${reason}${httpStatus ? `, HTTP ${httpStatus}` : ""})`);
    this.name = "ShopifyOAuthError";
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

async function postTokenRequest(
  shop: string,
  body: Record<string, string>,
  fetchImpl: FetchLike,
  now: Date,
): Promise<ShopifyTokenSet> {
  let response: Response;
  try {
    response = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body).toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ShopifyOAuthError("unavailable", null);
  }
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    throw new ShopifyOAuthError("rejected", response.status);
  }
  if (!response.ok) throw new ShopifyOAuthError("unavailable", response.status);

  try {
    return parseTokenResponse(await response.json(), now);
  } catch {
    throw new ShopifyOAuthError("bad_response", response.status);
  }
}

/** Redeems the one-time authorization code for an expiring offline token. */
export function exchangeAuthorizationCode(input: {
  shop: string;
  clientId: string;
  clientSecret: string;
  code: string;
  fetchImpl: FetchLike;
  now: Date;
}): Promise<ShopifyTokenSet> {
  return postTokenRequest(
    input.shop,
    { client_id: input.clientId, client_secret: input.clientSecret, code: input.code, expiring: "1" },
    input.fetchImpl,
    input.now,
  );
}

/**
 * Exchanges a refresh token for a new access token AND a new refresh token.
 * The previous refresh token stops working once Shopify issues the new one.
 */
export function refreshAccessToken(input: {
  shop: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl: FetchLike;
  now: Date;
}): Promise<ShopifyTokenSet> {
  return postTokenRequest(
    input.shop,
    {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    },
    input.fetchImpl,
    input.now,
  );
}

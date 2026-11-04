import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ServerEnv } from "@/server/env";
import { redactSecrets, sanitizeFields } from "@/server/logging";

import { getShopifyReadiness } from "./config";
import { createOAuthState, readOAuthState } from "./oauth-state";

const KEY = randomBytes(32).toString("base64");
const base = {
  NODE_ENV: "production",
  APP_URL: "https://dash.example.com/some/path",
  DATABASE_URL: "postgresql://x@db/agent",
  CREDENTIALS_ENCRYPTION_KEY: KEY,
  SHOPIFY_CLIENT_ID: "id",
  SHOPIFY_CLIENT_SECRET: "secret",
  SHOPIFY_STORE_DOMAIN: "drops-of-growth.myshopify.com",
  SHOPIFY_API_VERSION: "2026-10",
} as unknown as ServerEnv;

describe("Shopify readiness", () => {
  it("is ready with app credentials, PostgreSQL and a valid key; callback built from APP_URL", () => {
    const r = getShopifyReadiness(base, "postgres");
    expect(r.ready).toBe(true);
    if (!r.ready) return;
    expect(r.config.redirectUri).toBe("https://dash.example.com/api/integrations/shopify/callback");
    expect(r.config.secureCookies).toBe(true);
    expect(r.config.scopes).toEqual(["read_orders", "read_products"]);
  });

  it("reports missing settings by name only", () => {
    expect(getShopifyReadiness({ ...base, SHOPIFY_CLIENT_SECRET: undefined }, "postgres")).toEqual({
      ready: false,
      reason: "not_configured",
      missing: ["SHOPIFY_CLIENT_SECRET"],
    });
    expect(getShopifyReadiness({ ...base, DATABASE_URL: undefined }, "memory")).toMatchObject({
      reason: "storage_required",
      missing: ["DATABASE_URL"],
    });
    expect(getShopifyReadiness({ ...base, CREDENTIALS_ENCRYPTION_KEY: "too-short" }, "postgres")).toMatchObject({
      reason: "storage_required",
      missing: ["CREDENTIALS_ENCRYPTION_KEY"],
    });
  });

  it("requires https except on localhost", () => {
    expect(getShopifyReadiness({ ...base, APP_URL: "http://dash.example.com" }, "postgres")).toMatchObject({
      reason: "app_url_insecure",
    });
    const local = getShopifyReadiness({ ...base, APP_URL: "http://localhost:3000" }, "postgres");
    expect(local.ready && local.config.secureCookies).toBe(false);
  });
});

describe("OAuth state cookie", () => {
  const now = new Date("2026-11-04T10:00:00Z");

  it("round-trips and rejects tampering, other keys and old cookies", () => {
    const { state, cookieValue } = createOAuthState(KEY, "ar", now);
    expect(readOAuthState(cookieValue, KEY, now)).toEqual({ state, locale: "ar" });

    const [payload, signature] = cookieValue.split(".");
    const forged = Buffer.from(JSON.stringify({ s: "attacker", l: "en", t: now.getTime() })).toString("base64url");
    expect(readOAuthState(`${forged}.${signature}`, KEY, now)).toBeNull();
    expect(readOAuthState(`${payload}.${signature}x`, KEY, now)).toBeNull();
    expect(readOAuthState(cookieValue, randomBytes(32).toString("base64"), now)).toBeNull();
    expect(readOAuthState(cookieValue, KEY, new Date(now.getTime() + 11 * 60_000))).toBeNull();
    expect(readOAuthState(undefined, KEY, now)).toBeNull();
  });
});

describe("secure logging", () => {
  it("drops secret-bearing keys and redacts token-shaped values", () => {
    expect(
      sanitizeFields({
        shop: "drops.myshopify.com",
        accessToken: "shpat_abc",
        client_secret: "x",
        state: "nonce",
        errorCode: "SHOPIFY_UNAVAILABLE",
        detail: "got shpat_abcdef123 and shprt_zzz in a message",
      }),
    ).toEqual({
      shop: "drops.myshopify.com",
      errorCode: "SHOPIFY_UNAVAILABLE",
      detail: "got [redacted] and [redacted] in a message",
    });
    expect(redactSecrets("Authorization: Bearer abc.def")).toBe("Authorization: Bearer [redacted]");
    expect(redactSecrets("https://x/cb?code=123&state=abc&shop=s")).toBe("https://x/cb?code=[redacted]&state=[redacted]&shop=s");
  });
});

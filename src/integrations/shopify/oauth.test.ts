import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ShopifyOAuthError,
  assessScopes,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  isFreshTimestamp,
  normalizeShopDomain,
  parseScopes,
  parseTokenResponse,
  refreshAccessToken,
  verifyCallbackHmac,
  type FetchLike,
} from "@/integrations/shopify/oauth";

const SECRET = "test-client-secret";
const NOW = new Date("2026-11-04T10:00:00Z");

function signed(params: Record<string, string>, secret = SECRET) {
  const message = new URLSearchParams(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1))).toString();
  return new URLSearchParams({ ...params, hmac: createHmac("sha256", secret).update(message).digest("hex") });
}

const callback = {
  code: "0907a61c0c8d55e99db179b68161bc00",
  host: "YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvZHJvcHMtb2YtZ3Jvd3Ro",
  shop: "drops-of-growth.myshopify.com",
  state: "nonce-123",
  timestamp: String(NOW.getTime() / 1000),
};

describe("shop domain", () => {
  it("accepts only *.myshopify.com hosts, lower-cased", () => {
    expect(normalizeShopDomain(" Drops-Of-Growth.myshopify.com ")).toBe("drops-of-growth.myshopify.com");
    for (const bad of ["evil.com", "x.myshopify.com.evil.com", "https://x.myshopify.com", "-x.myshopify.com", "", null]) {
      expect(normalizeShopDomain(bad)).toBeNull();
    }
  });
});

describe("authorize URL", () => {
  it("targets the store, requests an offline token and carries the state", () => {
    const url = new URL(
      buildAuthorizeUrl({
        shop: "drops-of-growth.myshopify.com",
        clientId: "client-id",
        scopes: ["read_orders", "read_products"],
        redirectUri: "https://dash.example.com/api/integrations/shopify/callback",
        state: "nonce",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://drops-of-growth.myshopify.com/admin/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("scope")).toBe("read_orders,read_products");
    expect(url.searchParams.get("redirect_uri")).toBe("https://dash.example.com/api/integrations/shopify/callback");
    expect(url.searchParams.get("state")).toBe("nonce");
    expect(url.searchParams.has("grant_options[]")).toBe(false); // offline, not per-user
    expect(url.toString()).not.toContain(SECRET);
  });
});

describe("callback HMAC", () => {
  it("accepts Shopify's signature and rejects any tampering", () => {
    expect(verifyCallbackHmac(signed(callback), SECRET)).toBe(true);

    const tampered = signed(callback);
    tampered.set("shop", "attacker.myshopify.com");
    expect(verifyCallbackHmac(tampered, SECRET)).toBe(false);

    expect(verifyCallbackHmac(signed(callback, "other-secret"), SECRET)).toBe(false);
    expect(verifyCallbackHmac(new URLSearchParams(callback), SECRET)).toBe(false);

    const duplicated = signed(callback);
    duplicated.append("state", "second");
    expect(verifyCallbackHmac(duplicated, SECRET)).toBe(false);
  });

  it("rejects stale or missing timestamps", () => {
    expect(isFreshTimestamp(new URLSearchParams(callback), NOW)).toBe(true);
    expect(isFreshTimestamp(new URLSearchParams({ timestamp: String(NOW.getTime() / 1000 - 3600) }), NOW)).toBe(false);
    expect(isFreshTimestamp(new URLSearchParams({}), NOW)).toBe(false);
  });
});

describe("scopes", () => {
  it("parses and flags missing or write scopes", () => {
    expect(parseScopes("read_products, read_orders,read_orders")).toEqual(["read_orders", "read_products"]);
    expect(assessScopes(["read_orders", "read_products"])).toMatchObject({ missing: [], write: [] });
    expect(assessScopes(["read_orders"]).missing).toEqual(["read_products"]);
    expect(assessScopes(["read_orders", "read_products", "write_products"]).write).toEqual(["write_products"]);
    expect(assessScopes(["read_orders", "read_products", "read_all_orders"]).hasAllOrders).toBe(true);
  });
});

describe("token responses", () => {
  it("computes expiry instants for expiring offline tokens", () => {
    const tokens = parseTokenResponse(
      { access_token: "a", scope: "read_orders,read_products", expires_in: 3600, refresh_token: "r", refresh_token_expires_in: 7776000 },
      NOW,
    );
    expect(tokens.accessTokenExpiresAt?.toISOString()).toBe("2026-11-04T11:00:00.000Z");
    expect(tokens.refreshTokenExpiresAt?.toISOString()).toBe("2027-02-02T10:00:00.000Z"); // +90 days
    expect(tokens.scopes).toEqual(["read_orders", "read_products"]);
  });

  it("supports non-expiring tokens and rejects malformed bodies", () => {
    expect(parseTokenResponse({ access_token: "a", scope: "read_orders" }, NOW)).toMatchObject({
      refreshToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    });
    expect(() => parseTokenResponse({ token: "a" }, NOW)).toThrow();
  });
});

describe("token endpoint calls", () => {
  function recorder(response: Response) {
    const calls: { url: string; body: URLSearchParams; init: RequestInit }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, body: new URLSearchParams(String(init.body)), init });
      return response.clone();
    };
    return { calls, fetchImpl };
  }

  it("redeems the code for an expiring offline token (form-encoded, no redirects)", async () => {
    const { calls, fetchImpl } = recorder(
      new Response(JSON.stringify({ access_token: "shpat_x", scope: "read_orders,read_products", expires_in: 3600, refresh_token: "shprt_y" })),
    );
    const tokens = await exchangeAuthorizationCode({
      shop: "drops-of-growth.myshopify.com",
      clientId: "id",
      clientSecret: SECRET,
      code: "abc",
      fetchImpl,
      now: NOW,
    });
    expect(tokens.accessToken).toBe("shpat_x");
    expect(calls[0].url).toBe("https://drops-of-growth.myshopify.com/admin/oauth/access_token");
    expect(Object.fromEntries(calls[0].body)).toEqual({ client_id: "id", client_secret: SECRET, code: "abc", expiring: "1" });
    expect(calls[0].init.redirect).toBe("manual");
  });

  it("refreshes with grant_type=refresh_token", async () => {
    const { calls, fetchImpl } = recorder(new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_in: 3600 })));
    await refreshAccessToken({ shop: "s.myshopify.com", clientId: "id", clientSecret: SECRET, refreshToken: "r1", fetchImpl, now: NOW });
    expect(calls[0].body.get("grant_type")).toBe("refresh_token");
    expect(calls[0].body.get("refresh_token")).toBe("r1");
  });

  it("classifies failures without leaking secrets into the error", async () => {
    const rejected = recorder(new Response(JSON.stringify({ error: "invalid_request" }), { status: 401 }));
    const error = await refreshAccessToken({
      shop: "s.myshopify.com",
      clientId: "id",
      clientSecret: SECRET,
      refreshToken: "shprt_secret_value",
      fetchImpl: rejected.fetchImpl,
      now: NOW,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShopifyOAuthError);
    expect((error as ShopifyOAuthError).reason).toBe("rejected");
    expect(String((error as Error).message)).not.toMatch(/shprt_secret_value|test-client-secret/);

    const down = recorder(new Response("oops", { status: 503 }));
    await expect(
      refreshAccessToken({ shop: "s.myshopify.com", clientId: "id", clientSecret: SECRET, refreshToken: "r", fetchImpl: down.fetchImpl, now: NOW }),
    ).rejects.toMatchObject({ reason: "unavailable", httpStatus: 503 });

    // The per-request timeout is honoured (a hanging Shopify is aborted, not waited on).
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    await expect(
      refreshAccessToken({ shop: "s.myshopify.com", clientId: "id", clientSecret: SECRET, refreshToken: "r", fetchImpl: hanging, now: NOW, timeoutMs: 20 }),
    ).rejects.toMatchObject({ reason: "unavailable", httpStatus: null });

    const offline: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(
      exchangeAuthorizationCode({ shop: "s.myshopify.com", clientId: "id", clientSecret: SECRET, code: "c", fetchImpl: offline, now: NOW }),
    ).rejects.toMatchObject({ reason: "unavailable", httpStatus: null });
  });
});

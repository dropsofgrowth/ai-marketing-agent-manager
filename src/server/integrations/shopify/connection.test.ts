import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { DomainError } from "@/domain/errors";
import type { Actor } from "@/domain/types";
import { createTtlCache } from "@/lib/ttl-cache";
import { createMemoryLogger } from "@/server/logging";
import { decryptSecret } from "@/server/security/encryption";
import { buildDemoData, DEMO_USER, DEMO_WORKSPACE } from "@/server/store/demo-data";
import { createMemoryStore } from "@/server/store/memory-store";
import type { DataStore } from "@/server/store/types";

import { createFakeShopify } from "../../../../test/fake-shopify";

import type { ShopifyAppConfig, ShopifyReadiness } from "./config";
import { createShopifyConnectionService, type ShopifyConnectionService } from "./connection";
import { readOAuthState } from "./oauth-state";

const SHOP = "drops-of-growth.myshopify.com";
const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret-do-not-log";
const KEY = randomBytes(32).toString("base64");

const config: ShopifyAppConfig = {
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  shopDomain: SHOP,
  apiVersion: "2026-10",
  scopes: ["read_orders", "read_products"],
  redirectUri: "https://dash.example.com/api/integrations/shopify/callback",
  appUrl: "https://dash.example.com",
  encryptionKey: KEY,
  secureCookies: true,
};

const owner: Actor = { userId: DEMO_USER.id, workspaceId: DEMO_WORKSPACE.id, name: "Owner", role: "OWNER" };
const viewer: Actor = { ...owner, userId: "usr_viewer", role: "VIEWER" };

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof DomainError && e.code === code);
}

describe("Shopify connection service", () => {
  let clock: Date;
  let store: DataStore;
  let readiness: ShopifyReadiness;
  let fake: ReturnType<typeof createFakeShopify>;
  let logger: ReturnType<typeof createMemoryLogger>;
  let service: ShopifyConnectionService;

  beforeEach(() => {
    clock = new Date("2026-11-04T10:00:00Z");
    store = createMemoryStore({ ...buildDemoData(clock), audit: [] });
    readiness = { ready: true, config };
    fake = createFakeShopify({
      shop: SHOP,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      apiVersion: config.apiVersion,
      currency: "AED",
      timezone: "Asia/Dubai",
      now: () => clock,
    });
    logger = createMemoryLogger();
    service = createShopifyConnectionService({
      store,
      readiness: () => readiness,
      fetchImpl: fake.fetchImpl,
      logger,
      now: () => clock,
      cache: createTtlCache(),
      sleep: async () => {},
    });
  });

  /** Runs the full browser round trip: start → Shopify approval → callback. */
  async function connect(actor: Actor = owner) {
    const start = service.beginConnect(actor, "ar");
    const state = new URL(start.authorizeUrl).searchParams.get("state")!;
    const outcome = await service.completeConnect(actor, fake.callbackParams({ state }), start.cookieValue);
    return { start, outcome };
  }

  const current = () => store.connections.getCurrent(owner.workspaceId, "SHOPIFY");
  const allLogs = () => logger.lines.join("\n");

  it("starts the flow with a signed state cookie bound to the authorize URL", () => {
    const start = service.beginConnect(owner, "ar");
    const url = new URL(start.authorizeUrl);
    expect(url.host).toBe(SHOP);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    const stored = readOAuthState(start.cookieValue, KEY, clock);
    expect(stored).toEqual({ state: url.searchParams.get("state"), locale: "ar" });
    expect(start.cookieValue).not.toContain(CLIENT_SECRET);
    expect(start).toMatchObject({ secureCookie: true, maxAgeSeconds: 600 });
  });

  it("only lets owners and admins connect", async () => {
    expect(() => service.beginConnect(viewer, "en")).toThrow(DomainError);
    const start = service.beginConnect(owner, "en");
    const state = new URL(start.authorizeUrl).searchParams.get("state")!;
    const outcome = await service.completeConnect(viewer, fake.callbackParams({ state }), start.cookieValue);
    expect(outcome.result).toBe("FORBIDDEN");
    expect(fake.state.tokenRequests).toHaveLength(0);
  });

  it("connects: redeems the code, verifies the store, and stores only ciphertext", async () => {
    const { outcome } = await connect();
    expect(outcome).toEqual({ locale: "ar", result: "connected" });

    const connection = await current();
    expect(connection).toMatchObject({
      status: "CONNECTED",
      externalAccountId: SHOP,
      displayName: "Drops Of Growth",
      scopes: ["read_orders", "read_products"],
      credentialsKeyVersion: 1,
    });
    expect(connection?.accessTokenExpiresAt?.toISOString()).toBe("2026-11-04T11:00:00.000Z");
    expect(connection?.refreshTokenExpiresAt?.toISOString()).toBe("2027-02-02T10:00:00.000Z");

    const ciphertext = connection!.encryptedCredentials!;
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain("shpat_");
    expect(ciphertext).not.toContain("shprt_");
    const plaintext = JSON.parse(decryptSecret(ciphertext, KEY, `integration_connection:${owner.workspaceId}:SHOPIFY:${SHOP}`));
    expect(plaintext).toMatchObject({ accessToken: "shpat_fake_access_1", refreshToken: "shprt_fake_refresh_1" });

    // Token request asked for an expiring offline token; the code is single-use.
    expect(fake.state.tokenRequests[0].get("expiring")).toBe("1");
    const audit = await store.audit.list(owner.workspaceId);
    expect(audit[0]).toMatchObject({ action: "integration.connected", entityType: "integration" });

    // No secret, token or code ever reaches the logs.
    expect(allLogs()).not.toMatch(/shpat_|shprt_|test-client-secret|code_/);
  });

  it.each([
    ["no state cookie", (p: URLSearchParams) => p, () => undefined, "SHOPIFY_STATE_INVALID"],
    ["forged HMAC", (p: URLSearchParams) => (p.set("hmac", "0".repeat(64)), p), null, "SHOPIFY_SIGNATURE_INVALID"],
    ["state mismatch", null, null, "SHOPIFY_STATE_INVALID"],
    ["another store", null, null, "SHOPIFY_WRONG_STORE"],
    ["merchant cancelled", (p: URLSearchParams) => (p.set("error", "access_denied"), p), null, "SHOPIFY_CONNECT_CANCELLED"],
  ] as const)("rejects the callback on %s without redeeming the code", async (label, mutate, cookie, expected) => {
    const start = service.beginConnect(owner, "en");
    const state = new URL(start.authorizeUrl).searchParams.get("state")!;
    let params = fake.callbackParams({
      state: label === "state mismatch" ? "attacker-state" : state,
      shop: label === "another store" ? "attacker.myshopify.com" : SHOP,
    });
    if (mutate) params = mutate(params);
    const outcome = await service.completeConnect(owner, params, cookie ? cookie() : start.cookieValue);
    expect(outcome.result).toBe(expected);
    expect(fake.state.tokenRequests).toHaveLength(0);
    expect(await current()).toBeNull();
  });

  it("rejects a replayed (stale) callback", async () => {
    const start = service.beginConnect(owner, "en");
    const state = new URL(start.authorizeUrl).searchParams.get("state")!;
    const params = fake.callbackParams({ state, timestamp: new Date(clock.getTime() - 3_600_000) });
    expect((await service.completeConnect(owner, params, start.cookieValue)).result).toBe("SHOPIFY_SIGNATURE_INVALID");
  });

  it("refuses to store a token that has write access", async () => {
    fake.state.scopes = "read_orders,read_products,write_products";
    const { outcome } = await connect();
    expect(outcome.result).toBe("SHOPIFY_WRITE_SCOPES_GRANTED");
    expect(await current()).toBeNull();
  });

  it("refuses a token missing the required read scopes", async () => {
    fake.state.scopes = "read_products";
    expect((await connect()).outcome.result).toBe("SHOPIFY_MISSING_SCOPES");
    expect(await current()).toBeNull();
  });

  it("serves demo data until connected, live data after, and labels the reason", async () => {
    readiness = { ready: false, reason: "not_configured", missing: ["SHOPIFY_CLIENT_ID"] };
    expect(await service.resolveSource(owner.workspaceId)).toMatchObject({ mode: "demo", reason: "not_configured" });
    readiness = { ready: false, reason: "storage_required", missing: ["DATABASE_URL"] };
    expect(await service.resolveSource(owner.workspaceId)).toMatchObject({ mode: "demo", reason: "storage_required" });
    await expectCode(Promise.resolve().then(() => service.beginConnect(owner, "en")), "SHOPIFY_STORAGE_REQUIRED");

    readiness = { ready: true, config };
    const before = await service.resolveSource(owner.workspaceId);
    expect(before).toMatchObject({ mode: "demo", reason: "not_connected" });
    expect(before.mode === "demo" && before.service.info.mode).toBe("mock");

    await connect();
    fake.state.orders = [{ processedAt: "2026-11-03T08:00:00Z", total: "250.00" }];
    const source = await service.resolveSource(owner.workspaceId);
    expect(source.mode).toBe("live");
    if (source.mode !== "live") return;
    expect(source.service.info.mode).toBe("live");
    expect(await source.service.getShop()).toMatchObject({ name: "Drops Of Growth", currency: "AED", timezone: "Asia/Dubai" });
    const sales = await source.service.getDailySales({ from: "2026-11-03", to: "2026-11-03" });
    expect(sales.days[0]).toMatchObject({ orders: 1, revenueMinor: 25000 });
  });

  it("refreshes an expiring token once, under a lock, and stores the rotated refresh token", async () => {
    await connect();
    const before = (await current())!;
    clock = new Date(clock.getTime() + 58 * 60_000); // within the 5-minute refresh margin

    const source = await service.resolveSource(owner.workspaceId);
    if (source.mode !== "live") throw new Error("expected live");
    // Two concurrent reads must not both spend the (single-use) refresh token.
    await Promise.all([source.service.getShop(), source.service.listRecentOrders(5, clock)]);

    const refreshes = fake.state.tokenRequests.filter((r) => r.get("grant_type") === "refresh_token");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].get("refresh_token")).toBe("shprt_fake_refresh_1");

    const after = (await current())!;
    expect(after.encryptedCredentials).not.toBe(before.encryptedCredentials);
    expect(after.accessTokenExpiresAt!.getTime()).toBe(clock.getTime() + 3_600_000);
    const creds = JSON.parse(decryptSecret(after.encryptedCredentials!, KEY, `integration_connection:${owner.workspaceId}:SHOPIFY:${SHOP}`));
    expect(creds).toMatchObject({ accessToken: "shpat_fake_access_2", refreshToken: "shprt_fake_refresh_2" });
    expect(fake.state.refreshTokens.has("shprt_fake_refresh_1")).toBe(false);
    expect(allLogs()).not.toMatch(/shpat_|shprt_/);
  });

  it("asks for reconnection when Shopify rejects the refresh token, and never falls back to demo data", async () => {
    await connect();
    fake.state.refreshTokens.clear(); // e.g. expired or already used elsewhere
    clock = new Date(clock.getTime() + 2 * 3_600_000);

    const source = await service.resolveSource(owner.workspaceId);
    if (source.mode !== "live") throw new Error("expected live");
    await expectCode(source.service.getShop(), "SHOPIFY_RECONNECT_REQUIRED");

    const connection = (await current())!;
    expect(connection).toMatchObject({ status: "ERROR", lastError: "SHOPIFY_RECONNECT_REQUIRED", encryptedCredentials: null });
    expect(await service.resolveSource(owner.workspaceId)).toMatchObject({ mode: "error", code: "SHOPIFY_RECONNECT_REQUIRED" });
    expect((await store.audit.list(owner.workspaceId))[0].action).toBe("integration.error");
  });

  it("keeps the credentials on a transient refresh failure", async () => {
    await connect();
    clock = new Date(clock.getTime() + 2 * 3_600_000);
    const down = () => new Response("unavailable", { status: 503 });
    fake.state.tokenOverrides.push(down, down, down);

    const source = await service.resolveSource(owner.workspaceId);
    if (source.mode !== "live") throw new Error("expected live");
    await expectCode(source.service.getShop(), "SHOPIFY_UNAVAILABLE");
    const connection = (await current())!;
    expect(connection).toMatchObject({ status: "CONNECTED", lastError: "SHOPIFY_UNAVAILABLE" });
    expect(connection.encryptedCredentials).not.toBeNull();
  });

  it("marks the connection for reconnection when the app loses access (401 after refresh)", async () => {
    await connect();
    fake.state.accessTokens.clear(); // e.g. app uninstalled in the Shopify admin
    fake.state.refreshTokens.clear();
    const source = await service.resolveSource(owner.workspaceId);
    if (source.mode !== "live") throw new Error("expected live");
    await expect(source.service.getShop()).rejects.toBeTruthy();
    expect(await current()).toMatchObject({ status: "ERROR", lastError: "SHOPIFY_RECONNECT_REQUIRED" });
  });

  it("verifies the connection read-only and revokes on write scopes", async () => {
    await connect();
    const view = await service.verify(owner);
    expect(view).toMatchObject({ state: "connected", shopName: "Drops Of Growth", scopes: ["read_orders", "read_products"] });
    expect((await store.audit.list(owner.workspaceId))[0].action).toBe("integration.verified");
    await expectCode(service.verify(viewer), "FORBIDDEN");

    fake.state.installationScopes = ["read_orders", "read_products", "write_orders"];
    await expectCode(service.verify(owner), "SHOPIFY_WRITE_SCOPES_GRANTED");
    expect(await current()).toMatchObject({ status: "ERROR", encryptedCredentials: null });
  });

  it("disconnects by wiping the stored token", async () => {
    await connect();
    await expectCode(service.disconnect(viewer), "FORBIDDEN");
    await service.disconnect(owner);
    expect(await current()).toBeNull();
    expect(await service.resolveSource(owner.workspaceId)).toMatchObject({ mode: "demo", reason: "not_connected" });
    expect(await service.status(owner.workspaceId)).toMatchObject({ state: "ready" });
    await expectCode(service.disconnect(owner), "SHOPIFY_NOT_CONNECTED");
  });

  it("reports a non-sensitive status view", async () => {
    expect(await service.status(owner.workspaceId)).toEqual({ state: "ready", shopDomain: SHOP, redirectUri: config.redirectUri });
    await connect();
    const view = await service.status(owner.workspaceId);
    expect(view).toMatchObject({ state: "connected", hasAllOrders: false, hasInventory: false, warning: null });
    expect(JSON.stringify(view)).not.toMatch(/shpat_|shprt_|v1\./);
  });
});

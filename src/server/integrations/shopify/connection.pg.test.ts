/**
 * Token-refresh concurrency against a real PostgreSQL database: many "server
 * instances" (each with its own in-process state) share one deliberately small
 * connection pool while Shopify is slow to answer the refresh. Because no
 * transaction or row lock is held during the network call, the pool is never
 * starved, the single-use refresh token is spent exactly once, and every instance
 * ends up with a working token. Runs only when TEST_DATABASE_URL points at a
 * migrated, disposable database:
 *
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/server/integrations/shopify/connection.pg.test.ts
 */
import { randomBytes } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DomainError } from "@/domain/errors";
import type { Actor } from "@/domain/types";
import { PrismaClient } from "@/generated/prisma/client";
import { createTtlCache } from "@/lib/ttl-cache";
import { createMemoryLogger } from "@/server/logging";
import { createPrismaStore } from "@/server/store/prisma-store";
import type { DataStore } from "@/server/store/types";

import { createFakeShopify } from "../../../../test/fake-shopify";

import type { ShopifyAppConfig } from "./config";
import { createShopifyConnectionService } from "./connection";

const url = process.env.TEST_DATABASE_URL;
const WS = "ws_refresh_pg_test";
const USER = "usr_refresh_pg_test";
const SHOP = "drops-of-growth.myshopify.com";
const INSTANCES = 12;
const POOL_SIZE = 3;

const config: ShopifyAppConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret-do-not-log",
  shopDomain: SHOP,
  apiVersion: "2026-10",
  scopes: ["read_orders", "read_products"],
  redirectUri: "https://dash.example.com/api/integrations/shopify/callback",
  appUrl: "https://dash.example.com",
  encryptionKey: randomBytes(32).toString("base64"),
  secureCookies: true,
};
const owner: Actor = { userId: USER, workspaceId: WS, name: "Owner", role: "OWNER" };

describe.skipIf(!url)("Shopify token refresh on PostgreSQL (many instances, small pool)", () => {
  let prisma: PrismaClient;
  let store: DataStore;
  let clock: Date;
  let fake: ReturnType<typeof createFakeShopify>;
  let logger: ReturnType<typeof createMemoryLogger>;

  const instance = () =>
    createShopifyConnectionService({
      store,
      readiness: () => ({ ready: true, config }),
      fetchImpl: fake.fetchImpl,
      logger,
      now: () => clock,
      cache: createTtlCache(),
    });
  const refreshRequests = () => fake.state.tokenRequests.filter((r) => r.get("grant_type") === "refresh_token");
  const row = () => prisma.integrationConnection.findFirstOrThrow({ where: { workspaceId: WS, provider: "SHOPIFY" } });

  /** Each instance reads the shop concurrently; returns the settled results. */
  async function readFromAllInstances() {
    return Promise.allSettled(
      Array.from({ length: INSTANCES }, async () => {
        const source = await instance().resolveSource(WS);
        if (source.mode !== "live") throw new Error(`expected live, got ${source.mode}`);
        return source.service.getShop();
      }),
    );
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: POOL_SIZE }) });
    store = createPrismaStore(prisma);
    await prisma.workspace.upsert({ where: { id: WS }, update: {}, create: { id: WS, name: "Refresh test", slug: WS } });
    await prisma.user.upsert({ where: { id: USER }, update: {}, create: { id: USER, email: `${USER}@example.com`, name: "Owner" } });
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({ where: { workspaceId: WS } });
    await prisma.integrationConnection.deleteMany({ where: { workspaceId: WS } });
    clock = new Date("2026-11-04T10:00:00Z");
    logger = createMemoryLogger();
    fake = createFakeShopify({
      shop: SHOP,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      apiVersion: config.apiVersion,
      now: () => clock,
    });
    // Connect through the real OAuth flow, then move into the refresh window.
    const svc = instance();
    const start = svc.beginConnect(owner, "en");
    const state = new URL(start.authorizeUrl).searchParams.get("state")!;
    expect((await svc.completeConnect(owner, fake.callbackParams({ state }), start.cookieValue)).result).toBe("connected");
    clock = new Date(clock.getTime() + 58 * 60_000);
    fake.state.refreshDelayMs = 700; // Shopify is slow: longer than a lease poll
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { workspaceId: WS } });
    await prisma.integrationConnection.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.$disconnect();
  });

  it("refreshes exactly once and every instance gets a working token", async () => {
    const results = await readFromAllInstances();
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect(refreshRequests()).toHaveLength(1);
    // Every GraphQL call carried a token Shopify accepts (the original or the rotated one).
    expect(fake.state.graphqlRequests.every((r) => fake.state.accessTokens.has(r.token))).toBe(true);

    const stored = await row();
    expect(stored).toMatchObject({ status: "CONNECTED", lastError: null, refreshLeaseId: null, refreshLeaseUntil: null });
    // The rotated refresh token is the one stored: the next refresh works.
    expect(fake.state.refreshTokens.size).toBe(1);
    clock = new Date(clock.getTime() + 58 * 60_000);
    fake.state.refreshDelayMs = 0;
    expect((await readFromAllInstances()).every((r) => r.status === "fulfilled")).toBe(true);
    expect(refreshRequests()).toHaveLength(2);
  }, 30_000);

  it("flags a rejected refresh once, with one audit entry, however many instances hit it", async () => {
    fake.state.refreshTokens.clear();
    const results = await readFromAllInstances();
    for (const r of results) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected") expect((r.reason as DomainError).code).toBe("SHOPIFY_RECONNECT_REQUIRED");
    }
    expect(refreshRequests()).toHaveLength(1);
    expect(await row()).toMatchObject({ status: "ERROR", lastError: "SHOPIFY_RECONNECT_REQUIRED", encryptedCredentials: null });
    const errors = await prisma.auditLog.findMany({ where: { workspaceId: WS, action: "integration.error" } });
    expect(errors).toHaveLength(1);
  }, 30_000);
});

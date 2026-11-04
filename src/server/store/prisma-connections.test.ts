/**
 * Integration test for the PostgreSQL connection repository (refresh lease,
 * conditional updates, revoke on reconnect, safety constraints). Runs only when TEST_DATABASE_URL points at a
 * migrated, disposable database:
 *
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/server/store/prisma-connections.test.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

import { createPrismaStore } from "./prisma-store";
import type { DataStore, SaveConnectionInput } from "./types";

const url = process.env.TEST_DATABASE_URL;
const WS = "ws_conn_test";
const CIPHER = "v1.aaaa.bbbb.cccc";
/** Deliberately not ciphertext (and not token-shaped, so secret scanners stay quiet). */
const PLAINTEXT = "plaintext-credentials-not-encrypted";

describe.skipIf(!url)("PostgreSQL connection repository", () => {
  let prisma: PrismaClient;
  let store: DataStore;

  const input = (overrides: Partial<SaveConnectionInput> = {}): SaveConnectionInput => ({
    workspaceId: WS,
    provider: "SHOPIFY",
    externalAccountId: "drops-of-growth.myshopify.com",
    displayName: "Drops",
    scopes: ["read_orders", "read_products"],
    encryptedCredentials: CIPHER,
    credentialsKeyVersion: 1,
    accessTokenExpiresAt: new Date("2026-11-04T11:00:00Z"),
    refreshTokenExpiresAt: new Date("2027-02-02T10:00:00Z"),
    connectedAt: new Date("2026-11-04T10:00:00Z"),
    lastSyncedAt: new Date("2026-11-04T10:00:00Z"),
    ...overrides,
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    store = createPrismaStore(prisma);
    await prisma.workspace.upsert({ where: { id: WS }, update: {}, create: { id: WS, name: "Test", slug: WS } });
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({ where: { workspaceId: WS } });
    await prisma.integrationConnection.deleteMany({ where: { workspaceId: WS } });
  });

  afterAll(async () => {
    await prisma.integrationConnection.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await prisma.$disconnect();
  });

  it("saves, reconnects in place, and revokes a different store", async () => {
    const first = await store.connections.saveConnected(input());
    const again = await store.connections.saveConnected(input({ displayName: "Drops 2" }));
    expect(again.id).toBe(first.id);

    const other = await store.connections.saveConnected(input({ externalAccountId: "other.myshopify.com" }));
    expect((await store.connections.getCurrent(WS, "SHOPIFY"))?.id).toBe(other.id);
    const revoked = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: first.id } });
    expect(revoked).toMatchObject({ status: "REVOKED", encryptedCredentials: null, accessTokenExpiresAt: null });
  });

  it("grants the refresh lease to exactly one of many concurrent callers", async () => {
    const saved = await store.connections.saveConnected(input());
    const now = new Date("2026-11-04T10:58:00Z");
    const until = new Date(now.getTime() + 60_000);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => store.connections.acquireRefreshLease(WS, saved.id, `lease-${i}`, now, until)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = `lease-${results.indexOf(true)}`;
    expect(await store.connections.get(WS, saved.id)).toMatchObject({ refreshLeaseId: winner, refreshLeaseUntil: until });

    // Only the holder can complete it; completing releases it.
    expect(await store.connections.completeRefreshLease(WS, saved.id, "someone-else", { lastError: "X" })).toBeNull();
    const done = await store.connections.completeRefreshLease(WS, saved.id, winner, { encryptedCredentials: "v1.new.cipher.text" });
    expect(done).toMatchObject({ encryptedCredentials: "v1.new.cipher.text", refreshLeaseId: null, refreshLeaseUntil: null });
    expect(await store.connections.acquireRefreshLease(WS, saved.id, "next", now, until)).toBe(true);
  });

  it("lets an expired lease be taken over, and the late holder can no longer write", async () => {
    const saved = await store.connections.saveConnected(input());
    const t0 = new Date("2026-11-04T10:58:00Z");
    expect(await store.connections.acquireRefreshLease(WS, saved.id, "crashed", t0, new Date(t0.getTime() + 60_000))).toBe(true);
    expect(await store.connections.acquireRefreshLease(WS, saved.id, "early", new Date(t0.getTime() + 30_000), new Date(t0.getTime() + 90_000))).toBe(false);
    const later = new Date(t0.getTime() + 61_000);
    expect(await store.connections.acquireRefreshLease(WS, saved.id, "takeover", later, new Date(later.getTime() + 60_000))).toBe(true);
    expect(await store.connections.completeRefreshLease(WS, saved.id, "crashed", { encryptedCredentials: "v1.stale.cipher.text" })).toBeNull();
    expect((await store.connections.get(WS, saved.id))?.encryptedCredentials).toBe(CIPHER);
  });

  it("never completes a lease on a connection that was disconnected or flagged meanwhile", async () => {
    const saved = await store.connections.saveConnected(input());
    const now = new Date("2026-11-04T10:58:00Z");
    expect(await store.connections.acquireRefreshLease(WS, saved.id, "L", now, new Date(now.getTime() + 60_000))).toBe(true);
    await store.connections.update(WS, saved.id, {
      status: "REVOKED",
      encryptedCredentials: null,
      credentialsKeyVersion: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    });
    expect(await store.connections.completeRefreshLease(WS, saved.id, "L", { encryptedCredentials: "v1.late.cipher.text" })).toBeNull();
    expect(await store.connections.get(WS, saved.id)).toMatchObject({ status: "REVOKED", encryptedCredentials: null });
    expect(await store.connections.acquireRefreshLease(WS, saved.id, "M", now, new Date(now.getTime() + 60_000))).toBe(false);
  });

  it("applies a conditional status change for exactly one concurrent caller", async () => {
    const saved = await store.connections.saveConnected(input());
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.connections.updateIfStatus(WS, saved.id, "CONNECTED", { status: "ERROR", lastError: "SHOPIFY_RECONNECT_REQUIRED" }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.connections.get(WS, saved.id)).toMatchObject({ status: "ERROR", lastError: "SHOPIFY_RECONNECT_REQUIRED" });
    expect(await store.connections.get("other-workspace", saved.id)).toBeNull(); // tenant-scoped
  });

  it("refuses plaintext credentials in code and in the database", async () => {
    await expect(store.connections.saveConnected(input({ encryptedCredentials: PLAINTEXT }))).rejects.toThrow(/not encrypted/);
    await expect(
      prisma.integrationConnection.create({
        data: { workspaceId: WS, provider: "SHOPIFY", status: "CONNECTED", encryptedCredentials: PLAINTEXT },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.integrationConnection.create({ data: { workspaceId: WS, provider: "SHOPIFY", status: "CONNECTED" } }),
    ).rejects.toThrow();
  });
});

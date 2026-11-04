/**
 * Integration test for the PostgreSQL connection repository (row lock, revoke on
 * reconnect, safety constraints). Runs only when TEST_DATABASE_URL points at a
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

  it("serializes withLock() across concurrent callers (SELECT … FOR UPDATE)", async () => {
    const saved = await store.connections.saveConnected(input());
    const order: string[] = [];
    const slow = store.connections.withLock(WS, saved.id, async (current, tx) => {
      order.push("A:start");
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.update(WS, saved.id, { encryptedCredentials: "v1.new.cipher.text" });
      order.push("A:end");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = store.connections.withLock(WS, saved.id, async (current) => {
      order.push("B:start");
      return current?.encryptedCredentials;
    });
    const [, seenByB] = await Promise.all([slow, second]);
    expect(order).toEqual(["A:start", "A:end", "B:start"]);
    expect(seenByB).toBe("v1.new.cipher.text"); // B re-read the row after A committed
  });

  it("refuses plaintext credentials in code and in the database", async () => {
    await expect(store.connections.saveConnected(input({ encryptedCredentials: "shpat_plaintext" }))).rejects.toThrow(/not encrypted/);
    await expect(
      prisma.integrationConnection.create({
        data: { workspaceId: WS, provider: "SHOPIFY", status: "CONNECTED", encryptedCredentials: "shpat_plaintext" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.integrationConnection.create({ data: { workspaceId: WS, provider: "SHOPIFY", status: "CONNECTED" } }),
    ).rejects.toThrow();
  });
});

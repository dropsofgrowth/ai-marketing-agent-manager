import "server-only";

import { OPEN_APPROVAL_STATUSES } from "@/domain/approvals/state-machine";
import { DomainError } from "@/domain/errors";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import { toApproval, toAuditEntry, toAutomation, toConnection, toCreative } from "./prisma-mappers";
import {
  CURRENT_CONNECTION_STATUSES,
  assertCiphertext,
  emptyStatusCounts,
  type ConnectionRepository,
  type DataStore,
} from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

const json = (value: unknown) => value as Prisma.InputJsonValue;
const nullableJson = (value: unknown) =>
  value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function build(db: Db, root: PrismaClient): DataStore {
  /** Runs `fn` in the current transaction, or opens one. */
  const inTransaction = <T>(fn: (tx: Db) => Promise<T>) => (db !== root ? fn(db) : root.$transaction((tx) => fn(tx)));

  const connections: ConnectionRepository = {
    async getCurrent(workspaceId, provider) {
      const row = await db.integrationConnection.findFirst({
        where: { workspaceId, provider, status: { in: [...CURRENT_CONNECTION_STATUSES] } },
        orderBy: { updatedAt: "desc" },
      });
      return row ? toConnection(row) : null;
    },
    async saveConnected(input) {
      assertCiphertext(input.encryptedCredentials);
      return inTransaction(async (tx) => {
        // Revoke (and wipe) any other current connection first so the partial
        // unique index "one current connection per provider" is never violated.
        await tx.integrationConnection.updateMany({
          where: {
            workspaceId: input.workspaceId,
            provider: input.provider,
            status: { in: [...CURRENT_CONNECTION_STATUSES] },
            OR: [{ externalAccountId: { not: input.externalAccountId } }, { externalAccountId: null }],
          },
          data: {
            status: "REVOKED",
            encryptedCredentials: null,
            credentialsKeyVersion: null,
            accessTokenExpiresAt: null,
            refreshTokenExpiresAt: null,
          },
        });
        const fields = {
          status: "CONNECTED" as const,
          displayName: input.displayName,
          scopes: input.scopes,
          encryptedCredentials: input.encryptedCredentials,
          credentialsKeyVersion: input.credentialsKeyVersion,
          accessTokenExpiresAt: input.accessTokenExpiresAt,
          refreshTokenExpiresAt: input.refreshTokenExpiresAt,
          connectedAt: input.connectedAt,
          lastSyncedAt: input.lastSyncedAt,
          lastError: null,
          refreshLeaseId: null,
          refreshLeaseUntil: null,
        };
        const row = await tx.integrationConnection.upsert({
          where: {
            workspaceId_provider_externalAccountId: {
              workspaceId: input.workspaceId,
              provider: input.provider,
              externalAccountId: input.externalAccountId,
            },
          },
          create: {
            workspaceId: input.workspaceId,
            provider: input.provider,
            externalAccountId: input.externalAccountId,
            ...fields,
          },
          update: fields,
        });
        return toConnection(row);
      });
    },
    async update(workspaceId, id, patch) {
      assertCiphertext(patch.encryptedCredentials);
      const { count } = await db.integrationConnection.updateMany({ where: { workspaceId, id }, data: patch });
      if (!count) return null;
      const row = await db.integrationConnection.findFirst({ where: { workspaceId, id } });
      return row ? toConnection(row) : null;
    },
    async get(workspaceId, id) {
      const row = await db.integrationConnection.findFirst({ where: { workspaceId, id } });
      return row ? toConnection(row) : null;
    },
    async updateIfStatus(workspaceId, id, status, patch) {
      assertCiphertext(patch.encryptedCredentials);
      const { count } = await db.integrationConnection.updateMany({ where: { workspaceId, id, status }, data: patch });
      return count ? connections.get(workspaceId, id) : null;
    },
    async acquireRefreshLease(workspaceId, id, leaseId, now, until) {
      // A single UPDATE: concurrent claimants serialize on the row and re-check the
      // WHERE clause, so at most one wins. Nothing stays locked afterwards.
      const { count } = await db.integrationConnection.updateMany({
        where: {
          workspaceId,
          id,
          status: "CONNECTED",
          OR: [{ refreshLeaseUntil: null }, { refreshLeaseUntil: { lt: now } }],
        },
        data: { refreshLeaseId: leaseId, refreshLeaseUntil: until },
      });
      return count === 1;
    },
    async completeRefreshLease(workspaceId, id, leaseId, patch) {
      assertCiphertext(patch.encryptedCredentials);
      const { count } = await db.integrationConnection.updateMany({
        where: { workspaceId, id, refreshLeaseId: leaseId, status: "CONNECTED" },
        data: { ...patch, refreshLeaseId: null, refreshLeaseUntil: null },
      });
      return count ? connections.get(workspaceId, id) : null;
    },
  };

  const store: DataStore = {
    kind: "postgres",

    approvals: {
      async list(workspaceId, filter) {
        const rows = await db.approvalRequest.findMany({
          where: { workspaceId, ...(filter?.statuses ? { status: { in: [...filter.statuses] } } : {}) },
          orderBy: { createdAt: "desc" },
          take: filter?.limit,
        });
        return rows.map(toApproval);
      },
      async get(workspaceId, id) {
        const row = await db.approvalRequest.findFirst({ where: { workspaceId, id } });
        return row ? toApproval(row) : null;
      },
      async findOpenForTarget(workspaceId, type, targetExternalId, creativeId) {
        const row = await db.approvalRequest.findFirst({
          where: {
            workspaceId,
            type,
            targetExternalId,
            creativeId: creativeId ?? null,
            status: { in: [...OPEN_APPROVAL_STATUSES] },
          },
        });
        return row ? toApproval(row) : null;
      },
      async create(input) {
        try {
          const row = await db.approvalRequest.create({
            data: {
              workspaceId: input.workspaceId,
              type: input.type,
              title: input.title,
              rationale: input.rationale,
              payload: json(input.payload),
              riskLevel: input.riskLevel,
              source: input.source,
              sourceRef: input.sourceRef,
              provider: input.provider,
              targetExternalId: input.targetExternalId,
              targetName: input.targetName,
              creativeId: input.creativeId,
              requestedById: input.requestedById,
              requestedByLabel: input.requestedByLabel,
              expiresAt: input.expiresAt,
            },
          });
          return toApproval(row);
        } catch (error) {
          // The partial unique index caught a concurrent duplicate.
          if (isUniqueViolation(error)) throw new DomainError("DUPLICATE_OPEN_REQUEST");
          throw error;
        }
      },
      async transition(workspaceId, id, { from, expectedVersion, patch }) {
        const { count } = await db.approvalRequest.updateMany({
          where: { workspaceId, id, status: from, version: expectedVersion },
          data: {
            status: patch.status,
            ...(patch.reviewedById !== undefined ? { reviewedById: patch.reviewedById } : {}),
            ...(patch.reviewNote !== undefined ? { reviewNote: patch.reviewNote } : {}),
            ...(patch.reviewedAt !== undefined ? { reviewedAt: patch.reviewedAt } : {}),
            ...(patch.executionMode !== undefined ? { executionMode: patch.executionMode } : {}),
            ...(patch.executedAt !== undefined ? { executedAt: patch.executedAt } : {}),
            ...(patch.executionResult !== undefined
              ? { executionResult: nullableJson(patch.executionResult) }
              : {}),
            version: { increment: 1 },
          },
        });
        if (count === 0) return null;
        return store.approvals.get(workspaceId, id);
      },
      async countByStatus(workspaceId) {
        const groups = await db.approvalRequest.groupBy({
          by: ["status"],
          where: { workspaceId },
          _count: { _all: true },
        });
        const counts = emptyStatusCounts();
        for (const g of groups) counts[g.status] = g._count._all;
        return counts;
      },
    },

    creatives: {
      async list(workspaceId) {
        const rows = await db.creative.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
        return rows.map(toCreative);
      },
      async get(workspaceId, id) {
        const row = await db.creative.findFirst({ where: { workspaceId, id } });
        return row ? toCreative(row) : null;
      },
      async create(input) {
        const row = await db.creative.create({
          data: {
            workspaceId: input.workspaceId,
            title: input.title,
            prompt: input.prompt,
            format: input.format,
            aspectRatio: input.aspectRatio,
            status: input.status,
            providerJobId: input.providerJobId,
            assetUrl: input.assetUrl,
            thumbnailUrl: input.thumbnailUrl,
            headline: input.headline,
            primaryText: input.primaryText,
            callToAction: input.callToAction,
            metadata: nullableJson(input.metadata),
            createdById: input.createdById,
          },
        });
        return toCreative(row);
      },
      async setStatus(workspaceId, id, status) {
        await db.creative.updateMany({ where: { workspaceId, id }, data: { status } });
      },
    },

    automations: {
      async list(workspaceId) {
        const rows = await db.automation.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
        return rows.map(toAutomation);
      },
      async get(workspaceId, id) {
        const row = await db.automation.findFirst({ where: { workspaceId, id } });
        return row ? toAutomation(row) : null;
      },
      async setEnabled(workspaceId, id, enabled) {
        const { count } = await db.automation.updateMany({ where: { workspaceId, id }, data: { enabled } });
        return count ? store.automations.get(workspaceId, id) : null;
      },
      async markEvaluated(workspaceId, id, at) {
        await db.automation.updateMany({ where: { workspaceId, id }, data: { lastEvaluatedAt: at } });
      },
    },

    audit: {
      async record(entry) {
        await db.auditLog.create({
          data: {
            workspaceId: entry.workspaceId,
            actorId: entry.actorId,
            actorLabel: entry.actorLabel,
            action: entry.action,
            entityType: entry.entityType,
            entityId: entry.entityId,
            metadata: nullableJson(entry.metadata),
          },
        });
      },
      async list(workspaceId, options) {
        const rows = await db.auditLog.findMany({
          where: { workspaceId },
          orderBy: { createdAt: "desc" },
          take: options?.limit ?? 50,
        });
        return rows.map(toAuditEntry);
      },
    },

    connections,

    async transaction(fn) {
      if (db !== root) return fn(store); // already inside a transaction
      return root.$transaction((tx) => fn(build(tx, root)));
    },

    async ping() {
      await root.$queryRaw`SELECT 1`;
    },
  };
  return store;
}

export function createPrismaStore(prisma: PrismaClient): DataStore {
  return build(prisma, prisma);
}

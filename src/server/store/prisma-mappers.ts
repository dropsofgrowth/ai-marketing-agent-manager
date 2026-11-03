/**
 * Row ↔ domain mapping for the Prisma store. JSON columns are validated with zod
 * on the way out so a malformed row fails loudly instead of rendering garbage.
 */
import { z } from "zod";

import {
  budgetChangePayloadSchema,
  creativePublishPayloadSchema,
  executionResultSchema,
} from "@/domain/approvals/schemas";
import { cutLosersConfigSchema, scaleWinnersConfigSchema } from "@/domain/automations/rules";
import {
  ASPECT_RATIOS,
  AUDIT_ACTIONS,
  type ApprovalRequest,
  type AuditLogEntry,
  type Automation,
  type Creative,
} from "@/domain/types";
import type {
  ApprovalRequest as ApprovalRow,
  AuditLog as AuditRow,
  Automation as AutomationRow,
  Creative as CreativeRow,
} from "@/generated/prisma/client";

const flatRecordSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .nullable();

export function toApproval(row: ApprovalRow): ApprovalRequest {
  const base = {
    id: row.id,
    workspaceId: row.workspaceId,
    status: row.status,
    title: row.title,
    rationale: row.rationale,
    riskLevel: row.riskLevel,
    source: row.source,
    sourceRef: row.sourceRef,
    provider: row.provider,
    targetExternalId: row.targetExternalId,
    targetName: row.targetName,
    creativeId: row.creativeId,
    requestedById: row.requestedById,
    requestedByLabel: row.requestedByLabel,
    reviewedById: row.reviewedById,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt,
    executionMode: row.executionMode,
    executedAt: row.executedAt,
    executionResult: row.executionResult ? executionResultSchema.parse(row.executionResult) : null,
    expiresAt: row.expiresAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.type === "BUDGET_CHANGE") {
    return { ...base, type: "BUDGET_CHANGE", payload: budgetChangePayloadSchema.parse(row.payload) };
  }
  return { ...base, type: "CREATIVE_PUBLISH", payload: creativePublishPayloadSchema.parse(row.payload) };
}

export function toCreative(row: CreativeRow): Creative {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    prompt: row.prompt,
    format: row.format,
    aspectRatio: z.enum(ASPECT_RATIOS).parse(row.aspectRatio),
    status: row.status,
    providerJobId: row.providerJobId,
    assetUrl: row.assetUrl,
    thumbnailUrl: row.thumbnailUrl,
    headline: row.headline,
    primaryText: row.primaryText,
    callToAction: row.callToAction,
    metadata: flatRecordSchema.parse(row.metadata ?? null),
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toAutomation(row: AutomationRow): Automation {
  const base = {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    requiresApproval: true as const,
    lastEvaluatedAt: row.lastEvaluatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  switch (row.kind) {
    case "scale_winners":
      return { ...base, kind: "scale_winners", config: scaleWinnersConfigSchema.parse(row.config) };
    case "cut_losers":
      return { ...base, kind: "cut_losers", config: cutLosersConfigSchema.parse(row.config) };
    default:
      throw new Error(`Unknown automation kind "${row.kind}" on automation ${row.id}`);
  }
}

export function toAuditEntry(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    action: z.enum(AUDIT_ACTIONS).parse(row.action),
    entityType: z.enum(["approval", "creative", "automation", "integration"]).parse(row.entityType),
    entityId: row.entityId,
    metadata: flatRecordSchema.parse(row.metadata ?? null),
    createdAt: row.createdAt,
  };
}

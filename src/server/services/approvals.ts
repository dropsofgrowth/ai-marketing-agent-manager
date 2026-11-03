import { assessBudgetChange, type BudgetGuardrails } from "@/domain/approvals/guardrails";
import { assertTransition, isExpired } from "@/domain/approvals/state-machine";
import { DomainError } from "@/domain/errors";
import { percentChange, toMinorUnits } from "@/domain/money";
import { assertPermission } from "@/domain/permissions";
import type {
  Actor,
  ApprovalRequest,
  ApprovalStatus,
  AutomationTriggerSnapshot,
  RequestSource,
} from "@/domain/types";
import type { MetaCampaign } from "@/integrations/meta-ads/types";
import type { Integrations } from "@/integrations/registry";
import { runApprovedChange } from "@/server/approvals/executor";
import type { DataStore } from "@/server/store/types";

export type ApprovalConfig = {
  guardrails: BudgetGuardrails;
  ttlHours: number;
  requireSeparateApprover: boolean;
  /** LIVE_EXECUTION_ENABLED — recorded, but phase 1 always simulates. */
  liveExecutionRequested: boolean;
};

export type ApprovalServiceDeps = {
  store: DataStore;
  integrations: Integrations;
  config: ApprovalConfig;
  now: () => Date;
};

export type BudgetRequestOrigin =
  | { source: "USER"; actor: Actor }
  | { source: "AUTOMATION"; automationId: string; automationName: string; trigger: AutomationTriggerSnapshot };

/**
 * Human-in-the-loop approval workflow.
 *
 * - `request*` creates a PENDING request. Nothing is executed.
 * - `approve` / `reject` / `cancel` only change status (and creative status).
 * - `execute` is a separate, explicit human action on an APPROVED request. In
 *   phase 1 it runs as a dry run against mock adapters (see executor.ts).
 */
export function createApprovalService(deps: ApprovalServiceDeps) {
  const { store, integrations, config } = deps;

  async function loadCampaign(campaignId: string): Promise<MetaCampaign> {
    const campaign = await integrations.metaAds.getCampaign(campaignId);
    if (!campaign) throw new DomainError("NOT_FOUND", { entity: "campaign" });
    if (campaign.status === "ARCHIVED") throw new DomainError("CAMPAIGN_NOT_ACTIVE");
    return campaign;
  }

  async function loadForReview(workspaceId: string, id: string): Promise<ApprovalRequest> {
    const request = await store.approvals.get(workspaceId, id);
    if (!request) throw new DomainError("NOT_FOUND", { entity: "approval" });
    return request;
  }

  /** Transition helper: validates the edge and fails on concurrent modification. */
  async function transition(
    tx: DataStore,
    request: ApprovalRequest,
    to: ApprovalStatus,
    patch: Omit<Parameters<DataStore["approvals"]["transition"]>[2]["patch"], "status"> = {},
  ): Promise<ApprovalRequest> {
    assertTransition(request.status, to);
    const updated = await tx.approvals.transition(request.workspaceId, request.id, {
      from: request.status,
      expectedVersion: request.version,
      patch: { ...patch, status: to },
    });
    if (!updated) throw new DomainError("CONFLICT");
    return updated;
  }

  async function expireIfStale(actor: Actor, request: ApprovalRequest): Promise<void> {
    if (request.status !== "PENDING" || !isExpired(request.expiresAt, deps.now())) return;
    await store.transaction(async (tx) => {
      await transition(tx, request, "EXPIRED");
      await tx.audit.record({
        workspaceId: request.workspaceId,
        actorId: actor.userId,
        actorLabel: actor.name,
        action: "approval.expired",
        entityType: "approval",
        entityId: request.id,
        metadata: { type: request.type },
      });
    });
    throw new DomainError("EXPIRED");
  }

  async function createBudgetRequest(
    workspaceId: string,
    campaign: MetaCampaign,
    proposedDailyBudgetMinor: number,
    rationale: string | null,
    origin: BudgetRequestOrigin,
  ): Promise<ApprovalRequest> {
    const assessment = assessBudgetChange(campaign.dailyBudgetMinor, proposedDailyBudgetMinor, config.guardrails);
    const direction = proposedDailyBudgetMinor > campaign.dailyBudgetMinor ? "Increase" : "Decrease";
    const now = deps.now();

    const source: RequestSource = origin.source;
    const requestedById = origin.source === "USER" ? origin.actor.userId : null;
    const requestedByLabel =
      origin.source === "USER" ? origin.actor.name : `Automation: ${origin.automationName}`;

    return store.transaction(async (tx) => {
      const open = await tx.approvals.findOpenForTarget(workspaceId, "BUDGET_CHANGE", campaign.id, null);
      if (open) throw new DomainError("DUPLICATE_OPEN_REQUEST");

      const created = await tx.approvals.create({
        workspaceId,
        type: "BUDGET_CHANGE",
        title: `${direction} daily budget: ${campaign.name}`,
        rationale,
        riskLevel: assessment.riskLevel,
        source,
        sourceRef: origin.source === "AUTOMATION" ? origin.automationId : null,
        provider: "META_ADS",
        targetExternalId: campaign.id,
        targetName: campaign.name,
        creativeId: null,
        requestedById,
        requestedByLabel,
        expiresAt: new Date(now.getTime() + config.ttlHours * 3_600_000),
        payload: {
          campaignId: campaign.id,
          campaignName: campaign.name,
          currency: campaign.currency,
          currentDailyBudgetMinor: campaign.dailyBudgetMinor,
          proposedDailyBudgetMinor,
          changePercent: assessment.changePercent,
          ...(origin.source === "AUTOMATION" ? { trigger: origin.trigger } : {}),
        },
      });
      await tx.audit.record({
        workspaceId,
        actorId: requestedById,
        actorLabel: requestedByLabel,
        action: "approval.created",
        entityType: "approval",
        entityId: created.id,
        metadata: {
          type: "BUDGET_CHANGE",
          target: campaign.name,
          changePercent: assessment.changePercent,
          risk: assessment.riskLevel,
        },
      });
      return created;
    });
  }

  return {
    /** A person proposes a daily-budget change. Budget is read from the platform, never from the client. */
    async requestBudgetChange(
      actor: Actor,
      input: { campaignId: string; proposedDailyBudgetMajor: number; rationale?: string },
    ) {
      assertPermission(actor, "approval.request");
      const campaign = await loadCampaign(input.campaignId);
      const proposedMinor = toMinorUnits(input.proposedDailyBudgetMajor, campaign.currency);
      return createBudgetRequest(actor.workspaceId, campaign, proposedMinor, input.rationale ?? null, {
        source: "USER",
        actor,
      });
    },

    /** An automation proposes a change. Callers must have checked `automation.manage`. */
    async proposeBudgetChangeFromAutomation(
      workspaceId: string,
      input: {
        campaignId: string;
        proposedDailyBudgetMinor: number;
        rationale: string;
        automationId: string;
        automationName: string;
        trigger: AutomationTriggerSnapshot;
      },
    ) {
      const campaign = await loadCampaign(input.campaignId);
      return createBudgetRequest(workspaceId, campaign, input.proposedDailyBudgetMinor, input.rationale, {
        source: "AUTOMATION",
        automationId: input.automationId,
        automationName: input.automationName,
        trigger: input.trigger,
      });
    },

    async requestCreativePublish(
      actor: Actor,
      input: { creativeId: string; campaignId: string; rationale?: string },
    ) {
      assertPermission(actor, "approval.request");
      const creative = await store.creatives.get(actor.workspaceId, input.creativeId);
      if (!creative) throw new DomainError("NOT_FOUND", { entity: "creative" });
      if (creative.status !== "READY") throw new DomainError("CREATIVE_NOT_READY");
      const campaign = await loadCampaign(input.campaignId);
      const now = deps.now();

      return store.transaction(async (tx) => {
        const open = await tx.approvals.findOpenForTarget(
          actor.workspaceId,
          "CREATIVE_PUBLISH",
          campaign.id,
          creative.id,
        );
        if (open) throw new DomainError("DUPLICATE_OPEN_REQUEST");

        const created = await tx.approvals.create({
          workspaceId: actor.workspaceId,
          type: "CREATIVE_PUBLISH",
          title: `Publish creative: ${creative.title}`,
          rationale: input.rationale ?? null,
          riskLevel: "MEDIUM",
          source: "USER",
          sourceRef: null,
          provider: "META_ADS",
          targetExternalId: campaign.id,
          targetName: campaign.name,
          creativeId: creative.id,
          requestedById: actor.userId,
          requestedByLabel: actor.name,
          expiresAt: new Date(now.getTime() + config.ttlHours * 3_600_000),
          payload: {
            creativeId: creative.id,
            creativeTitle: creative.title,
            format: creative.format,
            aspectRatio: creative.aspectRatio,
            campaignId: campaign.id,
            campaignName: campaign.name,
            headline: creative.headline ?? "",
            primaryText: creative.primaryText ?? "",
            callToAction: creative.callToAction ?? "LEARN_MORE",
          },
        });
        await tx.creatives.setStatus(actor.workspaceId, creative.id, "PENDING_APPROVAL");
        await tx.audit.record({
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          actorLabel: actor.name,
          action: "approval.created",
          entityType: "approval",
          entityId: created.id,
          metadata: { type: "CREATIVE_PUBLISH", target: campaign.name, creative: creative.title },
        });
        return created;
      });
    },

    /** Approving records a decision only. It never calls an external platform. */
    async approve(actor: Actor, approvalId: string, note?: string) {
      assertPermission(actor, "approval.review");
      const request = await loadForReview(actor.workspaceId, approvalId);
      await expireIfStale(actor, request);
      assertTransition(request.status, "APPROVED");
      if (config.requireSeparateApprover && request.requestedById === actor.userId) {
        throw new DomainError("SELF_APPROVAL_FORBIDDEN");
      }

      return store.transaction(async (tx) => {
        const updated = await transition(tx, request, "APPROVED", {
          reviewedById: actor.userId,
          reviewNote: note ?? null,
          reviewedAt: deps.now(),
        });
        if (request.creativeId) await tx.creatives.setStatus(actor.workspaceId, request.creativeId, "APPROVED");
        await tx.audit.record({
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          actorLabel: actor.name,
          action: "approval.approved",
          entityType: "approval",
          entityId: request.id,
          metadata: { type: request.type, target: request.targetName },
        });
        return updated;
      });
    },

    async reject(actor: Actor, approvalId: string, note: string) {
      assertPermission(actor, "approval.review");
      if (note.trim().length < 3) throw new DomainError("INVALID_INPUT", { field: "note" });
      const request = await loadForReview(actor.workspaceId, approvalId);
      await expireIfStale(actor, request);

      return store.transaction(async (tx) => {
        const updated = await transition(tx, request, "REJECTED", {
          reviewedById: actor.userId,
          reviewNote: note,
          reviewedAt: deps.now(),
        });
        if (request.creativeId) await tx.creatives.setStatus(actor.workspaceId, request.creativeId, "READY");
        await tx.audit.record({
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          actorLabel: actor.name,
          action: "approval.rejected",
          entityType: "approval",
          entityId: request.id,
          metadata: { type: request.type, target: request.targetName },
        });
        return updated;
      });
    },

    async cancel(actor: Actor, approvalId: string) {
      assertPermission(actor, "approval.cancel");
      const request = await loadForReview(actor.workspaceId, approvalId);

      return store.transaction(async (tx) => {
        const updated = await transition(tx, request, "CANCELLED");
        if (request.creativeId) await tx.creatives.setStatus(actor.workspaceId, request.creativeId, "READY");
        await tx.audit.record({
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          actorLabel: actor.name,
          action: "approval.cancelled",
          entityType: "approval",
          entityId: request.id,
          metadata: { type: request.type, target: request.targetName },
        });
        return updated;
      });
    },

    /**
     * Explicit, human-triggered execution of an APPROVED request.
     * 1. Claim it (APPROVED → EXECUTING) so a double click cannot run it twice.
     * 2. Run it — phase 1: dry run against mock adapters only.
     * 3. Record EXECUTED or FAILED with the (simulated) result.
     */
    async execute(actor: Actor, approvalId: string) {
      assertPermission(actor, "approval.execute");
      const request = await loadForReview(actor.workspaceId, approvalId);
      const claimed = await transition(store, request, "EXECUTING");

      const result = await runApprovedChange(claimed, integrations, {
        now: deps.now(),
        liveExecutionRequested: config.liveExecutionRequested,
      });

      return store.transaction(async (tx) => {
        const finished = await transition(tx, claimed, result.ok ? "EXECUTED" : "FAILED", {
          executionMode: "SIMULATED",
          executedAt: deps.now(),
          executionResult: result,
        });
        await tx.audit.record({
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          actorLabel: actor.name,
          action: result.ok ? "approval.executed" : "approval.failed",
          entityType: "approval",
          entityId: request.id,
          metadata: { type: request.type, target: request.targetName, simulated: true },
        });
        return finished;
      });
    },
  };
}

export type ApprovalService = ReturnType<typeof createApprovalService>;

/** Convenience for UIs: the proposed budget change as a signed percentage. */
export function budgetChangePercent(currentMinor: number, proposedMinor: number) {
  return percentChange(currentMinor, proposedMinor);
}

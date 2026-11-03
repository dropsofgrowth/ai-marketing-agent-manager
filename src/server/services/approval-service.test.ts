import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/domain/errors";
import type { Actor } from "@/domain/types";
import { MockHiggsfieldService } from "@/integrations/higgsfield/mock";
import { MockMetaAdsService } from "@/integrations/meta-ads/mock";
import type { Integrations } from "@/integrations/registry";
import { MockShopifyService } from "@/integrations/shopify/mock";
import { createApprovalService, type ApprovalConfig } from "@/server/services/approvals";
import { createAutomationService } from "@/server/services/automations";
import { createCreativeService } from "@/server/services/creatives";
import { buildDemoData, DEMO_USER, DEMO_WORKSPACE } from "@/server/store/demo-data";
import { createMemoryStore } from "@/server/store/memory-store";
import type { DataStore } from "@/server/store/types";

const NOW = new Date("2026-11-03T12:00:00Z");
const RETARGETING = "120210000000000002";
const PROSPECTING = "120210000000000003";

const owner: Actor = { userId: DEMO_USER.id, workspaceId: DEMO_WORKSPACE.id, name: "Owner", role: "OWNER" };
const viewer: Actor = { ...owner, userId: "usr_viewer", role: "VIEWER" };
const otherOwner: Actor = { ...owner, userId: "usr_other", name: "Other" };

const config: ApprovalConfig = {
  guardrails: { maxIncreasePercent: 50, maxDecreasePercent: 80, maxDailyBudgetMinor: 5000_00 },
  ttlHours: 72,
  requireSeparateApprover: false,
  liveExecutionRequested: false,
};

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof DomainError && e.code === code);
}

describe("approval service", () => {
  let store: DataStore;
  let integrations: Integrations;
  let clock: Date;

  const service = (overrides: Partial<ApprovalConfig> = {}) =>
    createApprovalService({ store, integrations, config: { ...config, ...overrides }, now: () => clock });

  beforeEach(() => {
    clock = NOW;
    store = createMemoryStore({ ...buildDemoData(NOW), approvals: [], audit: [] });
    integrations = {
      metaAds: new MockMetaAdsService(),
      shopify: new MockShopifyService(),
      higgsfield: new MockHiggsfieldService(),
    };
  });

  it("creates a PENDING budget request using the platform's current budget", async () => {
    const request = await service().requestBudgetChange(owner, {
      campaignId: PROSPECTING,
      proposedDailyBudgetMajor: 300,
    });
    expect(request.status).toBe("PENDING");
    expect(request.type).toBe("BUDGET_CHANGE");
    if (request.type !== "BUDGET_CHANGE") throw new Error("unreachable");
    expect(request.payload.currentDailyBudgetMinor).toBe(250_00);
    expect(request.payload.proposedDailyBudgetMinor).toBe(300_00);
    expect(request.payload.changePercent).toBe(20);
    expect(request.expiresAt?.toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect((await store.audit.list(owner.workspaceId)).map((e) => e.action)).toEqual(["approval.created"]);
  });

  it("does not touch the ad platform when a request is created or approved", async () => {
    const budgetSpy = vi.spyOn(integrations.metaAds, "updateCampaignBudget");
    const publishSpy = vi.spyOn(integrations.metaAds, "publishCreative");
    const svc = service();
    const request = await svc.requestBudgetChange(owner, { campaignId: PROSPECTING, proposedDailyBudgetMajor: 275 });
    const approved = await svc.approve(owner, request.id, "Looks good");
    expect(approved.status).toBe("APPROVED");
    expect(budgetSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("executes only after approval, and only as a dry run", async () => {
    const budgetSpy = vi.spyOn(integrations.metaAds, "updateCampaignBudget");
    const svc = service();
    const request = await svc.requestBudgetChange(owner, { campaignId: PROSPECTING, proposedDailyBudgetMajor: 275 });

    await expectCode(svc.execute(owner, request.id), "INVALID_TRANSITION");
    expect(budgetSpy).not.toHaveBeenCalled();

    await svc.approve(owner, request.id);
    const executed = await svc.execute(owner, request.id);
    expect(executed.status).toBe("EXECUTED");
    expect(executed.executionMode).toBe("SIMULATED");
    expect(executed.executionResult).toMatchObject({ ok: true, simulated: true });
    expect(budgetSpy).toHaveBeenCalledWith(
      { campaignId: PROSPECTING, newDailyBudgetMinor: 275_00 },
      { dryRun: true },
    );

    // A second click cannot run it again.
    await expectCode(svc.execute(owner, request.id), "INVALID_TRANSITION");
    expect(budgetSpy).toHaveBeenCalledTimes(1);
  });

  it("flags LIVE_EXECUTION_ENABLED as unavailable instead of going live", async () => {
    const svc = service({ liveExecutionRequested: true });
    const request = await svc.requestBudgetChange(owner, { campaignId: PROSPECTING, proposedDailyBudgetMajor: 275 });
    await svc.approve(owner, request.id);
    const executed = await svc.execute(owner, request.id);
    expect(executed.executionResult).toMatchObject({ simulated: true, liveRequestedButUnavailable: true });
  });

  it("enforces guardrails, duplicates and permissions", async () => {
    const svc = service();
    await expectCode(
      svc.requestBudgetChange(owner, { campaignId: PROSPECTING, proposedDailyBudgetMajor: 1000 }),
      "GUARDRAIL_MAX_INCREASE",
    );
    await expectCode(
      svc.requestBudgetChange(viewer, { campaignId: PROSPECTING, proposedDailyBudgetMajor: 260 }),
      "FORBIDDEN",
    );
    await expectCode(
      svc.requestBudgetChange(owner, { campaignId: "missing", proposedDailyBudgetMajor: 260 }),
      "NOT_FOUND",
    );
    const first = await svc.requestBudgetChange(owner, { campaignId: RETARGETING, proposedDailyBudgetMajor: 130 });
    await expectCode(
      svc.requestBudgetChange(owner, { campaignId: RETARGETING, proposedDailyBudgetMajor: 140 }),
      "DUPLICATE_OPEN_REQUEST",
    );
    await expectCode(svc.approve(viewer, first.id), "FORBIDDEN");
  });

  it("supports the four-eyes rule", async () => {
    const svc = service({ requireSeparateApprover: true });
    const request = await svc.requestBudgetChange(owner, { campaignId: PROSPECTING, proposedDailyBudgetMajor: 275 });
    await expectCode(svc.approve(owner, request.id), "SELF_APPROVAL_FORBIDDEN");
    expect((await svc.approve(otherOwner, request.id)).status).toBe("APPROVED");
  });

  it("expires stale requests instead of approving them", async () => {
    const svc = service();
    const request = await svc.requestBudgetChange(owner, { campaignId: PROSPECTING, proposedDailyBudgetMajor: 275 });
    clock = new Date(NOW.getTime() + 73 * 3_600_000);
    await expectCode(svc.approve(owner, request.id), "EXPIRED");
    expect((await store.approvals.get(owner.workspaceId, request.id))?.status).toBe("EXPIRED");
  });

  it("rejects with a mandatory note and detects stale versions", async () => {
    const svc = service();
    const request = await svc.requestBudgetChange(owner, { campaignId: PROSPECTING, proposedDailyBudgetMajor: 275 });
    await expectCode(svc.reject(owner, request.id, " "), "INVALID_INPUT");

    const stale = await store.approvals.get(owner.workspaceId, request.id);
    await svc.reject(owner, request.id, "Not this week");
    const conflict = await store.approvals.transition(owner.workspaceId, request.id, {
      from: "PENDING",
      expectedVersion: stale!.version,
      patch: { status: "APPROVED" },
    });
    expect(conflict).toBeNull();
  });

  it("moves a creative through the publish workflow", async () => {
    const svc = service();
    const creatives = createCreativeService({ store, integrations });
    const creative = await creatives.generate(owner, {
      title: "Test creative",
      prompt: "A product photo on a clean background",
      format: "IMAGE",
      aspectRatio: "1:1",
    });
    expect(creative.status).toBe("READY");

    const request = await svc.requestCreativePublish(owner, { creativeId: creative.id, campaignId: RETARGETING });
    expect((await store.creatives.get(owner.workspaceId, creative.id))?.status).toBe("PENDING_APPROVAL");
    await expectCode(
      svc.requestCreativePublish(owner, { creativeId: creative.id, campaignId: RETARGETING }),
      "CREATIVE_NOT_READY",
    );

    await svc.reject(owner, request.id, "Wrong colours");
    expect((await store.creatives.get(owner.workspaceId, creative.id))?.status).toBe("READY");
  });
});

describe("automation service", () => {
  it("files proposals as PENDING requests and skips targets that already have one", async () => {
    const store = createMemoryStore({ ...buildDemoData(NOW), approvals: [], audit: [] });
    const integrations: Integrations = {
      metaAds: new MockMetaAdsService(),
      shopify: new MockShopifyService(),
      higgsfield: new MockHiggsfieldService(),
    };
    const budgetSpy = vi.spyOn(integrations.metaAds, "updateCampaignBudget");
    const now = () => NOW;
    const approvals = createApprovalService({ store, integrations, config, now });
    const automations = createAutomationService({ store, integrations, approvals, config, now });

    const first = await automations.evaluateAll(owner);
    expect(first.evaluated).toBe(2);
    expect(first.proposalsCreated).toBeGreaterThan(0);

    const pending = await store.approvals.list(owner.workspaceId, { statuses: ["PENDING"] });
    expect(pending).toHaveLength(first.proposalsCreated);
    expect(pending.every((p) => p.source === "AUTOMATION" && p.requestedById === null)).toBe(true);

    const second = await automations.evaluateAll(owner);
    expect(second.proposalsCreated).toBe(0);
    expect(second.skippedExisting).toBe(first.proposalsCreated);
    expect(budgetSpy).not.toHaveBeenCalled();
  });
});

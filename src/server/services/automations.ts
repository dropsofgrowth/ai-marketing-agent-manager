import { evaluateAutomation, type CampaignPerformance } from "@/domain/automations/rules";
import { DomainError, isDomainError } from "@/domain/errors";
import { formatPlainRoas } from "@/lib/plain-format";
import { assertPermission } from "@/domain/permissions";
import type { Actor } from "@/domain/types";
import type { Integrations } from "@/integrations/registry";
import { trailingRange } from "@/lib/dates";
import type { DataStore } from "@/server/store/types";

import type { ApprovalConfig, ApprovalService } from "./approvals";

export type AutomationRunSummary = {
  evaluated: number;
  proposalsCreated: number;
  skippedExisting: number;
  skippedGuardrail: number;
};

export function createAutomationService(deps: {
  store: DataStore;
  integrations: Integrations;
  approvals: ApprovalService;
  config: ApprovalConfig;
  now: () => Date;
}) {
  const { store, integrations, approvals, config } = deps;

  return {
    async setEnabled(actor: Actor, automationId: string, enabled: boolean) {
      assertPermission(actor, "automation.manage");
      const updated = await store.automations.setEnabled(actor.workspaceId, automationId, enabled);
      if (!updated) throw new DomainError("NOT_FOUND", { entity: "automation" });
      await store.audit.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        actorLabel: actor.name,
        action: enabled ? "automation.enabled" : "automation.disabled",
        entityType: "automation",
        entityId: automationId,
        metadata: { name: updated.name },
      });
      return updated;
    },

    /**
     * Evaluates every enabled automation against current performance and files a
     * PENDING approval request for each proposal. It never changes a budget.
     */
    async evaluateAll(actor: Actor): Promise<AutomationRunSummary> {
      assertPermission(actor, "automation.manage");
      const now = deps.now();
      const summary: AutomationRunSummary = {
        evaluated: 0,
        proposalsCreated: 0,
        skippedExisting: 0,
        skippedGuardrail: 0,
      };

      const [automations, campaigns] = await Promise.all([
        store.automations.list(actor.workspaceId),
        integrations.metaAds.listCampaigns(),
      ]);

      for (const automation of automations.filter((a) => a.enabled)) {
        summary.evaluated++;
        const insights = await integrations.metaAds.getCampaignInsights(
          trailingRange(automation.config.lookbackDays, now),
        );
        const performance: CampaignPerformance[] = campaigns.map((c) => {
          const metrics = insights.find((i) => i.campaignId === c.id)?.metrics;
          return {
            campaignId: c.id,
            campaignName: c.name,
            status: c.status,
            objective: c.objective,
            currency: c.currency,
            dailyBudgetMinor: c.dailyBudgetMinor,
            spendMinor: metrics?.spendMinor ?? 0,
            purchaseValueMinor: metrics?.purchaseValueMinor ?? 0,
          };
        });

        for (const proposal of evaluateAutomation(automation, performance, config.guardrails)) {
          const t = proposal.trigger;
          const rationale =
            t.kind === "scale_winners"
              ? `ROAS ${formatPlainRoas(t.roas)} over the last ${t.lookbackDays} days is at or above the ${formatPlainRoas(t.threshold)} target.`
              : `ROAS ${formatPlainRoas(t.roas)} over the last ${t.lookbackDays} days is below the ${formatPlainRoas(t.threshold)} break-even threshold.`;
          try {
            await approvals.proposeBudgetChangeFromAutomation(actor.workspaceId, {
              campaignId: proposal.campaignId,
              proposedDailyBudgetMinor: proposal.proposedDailyBudgetMinor,
              rationale,
              automationId: automation.id,
              automationName: automation.name,
              trigger: proposal.trigger,
            });
            summary.proposalsCreated++;
          } catch (error) {
            if (isDomainError(error) && error.code === "DUPLICATE_OPEN_REQUEST") summary.skippedExisting++;
            else if (isDomainError(error) && error.code.startsWith("GUARDRAIL_")) summary.skippedGuardrail++;
            else throw error;
          }
        }
        await store.automations.markEvaluated(actor.workspaceId, automation.id, now);
      }

      await store.audit.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        actorLabel: actor.name,
        action: "automation.evaluated",
        entityType: "automation",
        entityId: "all",
        metadata: { ...summary },
      });
      return summary;
    },
  };
}

export type AutomationService = ReturnType<typeof createAutomationService>;

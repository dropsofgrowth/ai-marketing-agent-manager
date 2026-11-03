import { z } from "zod";

import type { BudgetGuardrails } from "@/domain/approvals/guardrails";
import { percentChange, roundToWholeMajor } from "@/domain/money";
import type {
  Automation,
  AutomationTriggerSnapshot,
  CutLosersConfig,
  ScaleWinnersConfig,
} from "@/domain/types";

export const scaleWinnersConfigSchema = z.object({
  minRoas: z.number().positive(),
  minSpendMinor: z.number().int().nonnegative(),
  increasePercent: z.number().positive().max(100),
  lookbackDays: z.number().int().min(1).max(90),
}) satisfies z.ZodType<ScaleWinnersConfig>;

export const cutLosersConfigSchema = z.object({
  maxRoas: z.number().positive(),
  minSpendMinor: z.number().int().nonnegative(),
  decreasePercent: z.number().positive().max(100),
  lookbackDays: z.number().int().min(1).max(90),
}) satisfies z.ZodType<CutLosersConfig>;

/** Campaign performance aggregated over an automation's lookback window. */
export type CampaignPerformance = {
  campaignId: string;
  campaignName: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  objective: string;
  currency: string;
  dailyBudgetMinor: number;
  spendMinor: number;
  purchaseValueMinor: number;
};

export type BudgetProposal = {
  campaignId: string;
  campaignName: string;
  currency: string;
  currentDailyBudgetMinor: number;
  proposedDailyBudgetMinor: number;
  changePercent: number;
  trigger: AutomationTriggerSnapshot;
};

export function roasOf(p: Pick<CampaignPerformance, "spendMinor" | "purchaseValueMinor">): number {
  return p.spendMinor > 0 ? p.purchaseValueMinor / p.spendMinor : 0;
}

export function lookbackDaysOf(automation: Automation): number {
  return automation.config.lookbackDays;
}

/**
 * Pure rule evaluation: returns budget-change PROPOSALS. It never applies them —
 * the caller turns each proposal into a PENDING approval request.
 *
 * Proposed amounts are clamped to the guardrails so an automation can never
 * propose something a human could not request manually.
 */
export function evaluateAutomation(
  automation: Automation,
  campaigns: readonly CampaignPerformance[],
  guardrails: BudgetGuardrails,
): BudgetProposal[] {
  const proposals: BudgetProposal[] = [];

  for (const campaign of campaigns) {
    // ROAS rules only make sense for conversion campaigns.
    if (campaign.status !== "ACTIVE" || campaign.objective !== "SALES") continue;
    const roas = roasOf(campaign);

    let factor: number | null = null;
    let threshold = 0;

    if (automation.kind === "scale_winners") {
      const cfg = automation.config;
      if (campaign.spendMinor >= cfg.minSpendMinor && roas >= cfg.minRoas) {
        factor = 1 + Math.min(cfg.increasePercent, guardrails.maxIncreasePercent) / 100;
        threshold = cfg.minRoas;
      }
    } else {
      const cfg = automation.config;
      if (campaign.spendMinor >= cfg.minSpendMinor && roas < cfg.maxRoas) {
        factor = 1 - Math.min(cfg.decreasePercent, guardrails.maxDecreasePercent) / 100;
        threshold = cfg.maxRoas;
      }
    }

    if (factor === null) continue;

    let proposed = roundToWholeMajor(campaign.dailyBudgetMinor * factor, campaign.currency);
    proposed = Math.min(proposed, guardrails.maxDailyBudgetMinor);
    if (proposed <= 0 || proposed === campaign.dailyBudgetMinor) continue;

    // Rounding must never push the change past a guardrail.
    const change = percentChange(campaign.dailyBudgetMinor, proposed);
    if (change > guardrails.maxIncreasePercent || -change > guardrails.maxDecreasePercent) continue;

    proposals.push({
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      currency: campaign.currency,
      currentDailyBudgetMinor: campaign.dailyBudgetMinor,
      proposedDailyBudgetMinor: proposed,
      changePercent: change,
      trigger: {
        kind: automation.kind,
        roas: Math.round(roas * 100) / 100,
        spendMinor: campaign.spendMinor,
        lookbackDays: automation.config.lookbackDays,
        threshold,
      },
    });
  }

  return proposals;
}

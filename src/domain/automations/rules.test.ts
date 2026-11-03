import { describe, expect, it } from "vitest";

import { evaluateAutomation, type CampaignPerformance } from "@/domain/automations/rules";
import type { Automation } from "@/domain/types";

const guardrails = { maxIncreasePercent: 50, maxDecreasePercent: 80, maxDailyBudgetMinor: 5000_00 };
const now = new Date("2026-11-03T00:00:00Z");

const base = {
  workspaceId: "ws",
  description: null,
  enabled: true,
  requiresApproval: true as const,
  lastEvaluatedAt: null,
  createdAt: now,
  updatedAt: now,
};

const scale: Automation = {
  ...base,
  id: "a1",
  name: "Scale",
  kind: "scale_winners",
  config: { minRoas: 3, minSpendMinor: 500_00, increasePercent: 20, lookbackDays: 7 },
};

const cut: Automation = {
  ...base,
  id: "a2",
  name: "Cut",
  kind: "cut_losers",
  config: { maxRoas: 1, minSpendMinor: 300_00, decreasePercent: 30, lookbackDays: 7 },
};

function campaign(overrides: Partial<CampaignPerformance>): CampaignPerformance {
  return {
    campaignId: "c1",
    campaignName: "Campaign",
    status: "ACTIVE",
    objective: "SALES",
    currency: "USD",
    dailyBudgetMinor: 100_00,
    spendMinor: 700_00,
    purchaseValueMinor: 2800_00, // ROAS 4
    ...overrides,
  };
}

describe("evaluateAutomation", () => {
  it("proposes an increase for winners, rounded to whole currency units", () => {
    const [proposal] = evaluateAutomation(scale, [campaign({ dailyBudgetMinor: 123_45 })], guardrails);
    expect(proposal.proposedDailyBudgetMinor).toBe(148_00);
    expect(proposal.trigger).toMatchObject({ kind: "scale_winners", roas: 4, threshold: 3 });
  });

  it("proposes a decrease for losers", () => {
    const [proposal] = evaluateAutomation(cut, [campaign({ purchaseValueMinor: 560_00 })], guardrails);
    expect(proposal.proposedDailyBudgetMinor).toBe(70_00);
    expect(proposal.changePercent).toBe(-30);
  });

  it("ignores paused, non-sales and low-spend campaigns", () => {
    const campaigns = [
      campaign({ campaignId: "paused", status: "PAUSED" }),
      campaign({ campaignId: "awareness", objective: "AWARENESS" }),
      campaign({ campaignId: "small", spendMinor: 100_00, purchaseValueMinor: 400_00 }),
    ];
    expect(evaluateAutomation(scale, campaigns, guardrails)).toEqual([]);
  });

  it("never proposes more than the guardrails allow", () => {
    const greedy: Automation = { ...scale, config: { ...scale.config, increasePercent: 100 } };
    const [proposal] = evaluateAutomation(greedy, [campaign({ dailyBudgetMinor: 4000_00 })], guardrails);
    expect(proposal.proposedDailyBudgetMinor).toBe(5000_00); // clamped to the daily cap
    expect(proposal.changePercent).toBeLessThanOrEqual(guardrails.maxIncreasePercent);
  });
});

import { DomainError } from "@/domain/errors";
import { percentChange } from "@/domain/money";
import type { RiskLevel } from "@/domain/types";

export type BudgetGuardrails = {
  /** Max increase per request, in percent (e.g. 50). */
  maxIncreasePercent: number;
  /** Max decrease per request, in percent (e.g. 80). */
  maxDecreasePercent: number;
  /** Absolute ceiling for a daily budget, in minor units. */
  maxDailyBudgetMinor: number;
};

export type BudgetAssessment = {
  changePercent: number;
  riskLevel: RiskLevel;
};

/**
 * Validates a proposed daily-budget change against the workspace guardrails and
 * classifies its risk. Throws a DomainError when the change is not allowed at all.
 */
export function assessBudgetChange(
  currentMinor: number,
  proposedMinor: number,
  guardrails: BudgetGuardrails,
): BudgetAssessment {
  if (!Number.isFinite(proposedMinor) || !Number.isInteger(proposedMinor) || proposedMinor <= 0) {
    throw new DomainError("GUARDRAIL_NON_POSITIVE");
  }
  if (proposedMinor === currentMinor) {
    throw new DomainError("GUARDRAIL_NO_CHANGE");
  }
  if (proposedMinor > guardrails.maxDailyBudgetMinor) {
    throw new DomainError("GUARDRAIL_DAILY_CAP", { limitMinor: guardrails.maxDailyBudgetMinor });
  }

  const changePercent = percentChange(currentMinor, proposedMinor);
  if (changePercent > guardrails.maxIncreasePercent) {
    throw new DomainError("GUARDRAIL_MAX_INCREASE", { limit: guardrails.maxIncreasePercent });
  }
  if (-changePercent > guardrails.maxDecreasePercent) {
    throw new DomainError("GUARDRAIL_MAX_DECREASE", { limit: guardrails.maxDecreasePercent });
  }

  return { changePercent, riskLevel: classifyBudgetRisk(changePercent, proposedMinor, guardrails) };
}

/**
 * Risk heuristic:
 * - decreases are low risk unless very large (they reduce spend);
 * - increases scale with size and with how close the new budget is to the cap.
 */
export function classifyBudgetRisk(
  changePercent: number,
  proposedMinor: number,
  guardrails: BudgetGuardrails,
): RiskLevel {
  if (changePercent < 0) {
    return -changePercent > 50 ? "MEDIUM" : "LOW";
  }
  const shareOfCap = proposedMinor / guardrails.maxDailyBudgetMinor;
  if (changePercent > 35 || shareOfCap > 0.75) return "HIGH";
  if (changePercent > 15 || shareOfCap > 0.5) return "MEDIUM";
  return "LOW";
}

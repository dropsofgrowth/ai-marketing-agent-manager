import { describe, expect, it } from "vitest";

import { assessBudgetChange, type BudgetGuardrails } from "@/domain/approvals/guardrails";
import { canTransition, isExpired, isTerminal } from "@/domain/approvals/state-machine";
import { DomainError } from "@/domain/errors";
import { hasPermission } from "@/domain/permissions";
import { APPROVAL_STATUSES } from "@/domain/types";

const guardrails: BudgetGuardrails = {
  maxIncreasePercent: 50,
  maxDecreasePercent: 80,
  maxDailyBudgetMinor: 5000_00,
};

function codeOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : "OTHER";
  }
  return "NO_ERROR";
}

describe("approval state machine", () => {
  it("never allows execution without approval", () => {
    expect(canTransition("PENDING", "EXECUTING")).toBe(false);
    expect(canTransition("PENDING", "EXECUTED")).toBe(false);
    expect(canTransition("APPROVED", "EXECUTED")).toBe(false); // must be claimed first
    expect(canTransition("APPROVED", "EXECUTING")).toBe(true);
    expect(canTransition("EXECUTING", "EXECUTED")).toBe(true);
  });

  it("treats decided requests as terminal", () => {
    for (const status of ["REJECTED", "CANCELLED", "EXPIRED", "EXECUTED", "FAILED"] as const) {
      expect(isTerminal(status)).toBe(true);
      for (const to of APPROVAL_STATUSES) expect(canTransition(status, to)).toBe(false);
    }
  });

  it("detects expiry", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(new Date("2026-11-03T11:59:59Z"), now)).toBe(true);
    expect(isExpired(new Date("2026-11-03T12:00:01Z"), now)).toBe(false);
  });
});

describe("budget guardrails", () => {
  it("accepts changes inside the limits and classifies risk", () => {
    expect(assessBudgetChange(100_00, 110_00, guardrails)).toEqual({ changePercent: 10, riskLevel: "LOW" });
    expect(assessBudgetChange(100_00, 125_00, guardrails)).toEqual({ changePercent: 25, riskLevel: "MEDIUM" });
    expect(assessBudgetChange(100_00, 150_00, guardrails)).toEqual({ changePercent: 50, riskLevel: "HIGH" });
    expect(assessBudgetChange(100_00, 70_00, guardrails)).toEqual({ changePercent: -30, riskLevel: "LOW" });
  });

  it("escalates risk when close to the daily cap", () => {
    expect(assessBudgetChange(4000_00, 4100_00, guardrails).riskLevel).toBe("HIGH");
  });

  it("rejects changes outside the limits", () => {
    expect(codeOf(() => assessBudgetChange(100_00, 151_00, guardrails))).toBe("GUARDRAIL_MAX_INCREASE");
    expect(codeOf(() => assessBudgetChange(100_00, 19_00, guardrails))).toBe("GUARDRAIL_MAX_DECREASE");
    expect(codeOf(() => assessBudgetChange(4000_00, 5001_00, guardrails))).toBe("GUARDRAIL_DAILY_CAP");
    expect(codeOf(() => assessBudgetChange(100_00, 100_00, guardrails))).toBe("GUARDRAIL_NO_CHANGE");
    expect(codeOf(() => assessBudgetChange(100_00, 0, guardrails))).toBe("GUARDRAIL_NON_POSITIVE");
    expect(codeOf(() => assessBudgetChange(100_00, 10.5, guardrails))).toBe("GUARDRAIL_NON_POSITIVE");
  });
});

describe("permissions", () => {
  it("lets only reviewers approve", () => {
    expect(hasPermission("OWNER", "approval.review")).toBe(true);
    expect(hasPermission("APPROVER", "approval.review")).toBe(true);
    expect(hasPermission("EDITOR", "approval.review")).toBe(false);
    expect(hasPermission("VIEWER", "approval.request")).toBe(false);
  });
});

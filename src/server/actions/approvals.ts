"use server";

import {
  approvalIdInputSchema,
  budgetChangeInputSchema,
  creativePublishInputSchema,
  rejectInputSchema,
  reviewInputSchema,
} from "@/domain/approvals/schemas";
import { getServices } from "@/server/services";

import type { ActionResult } from "./result";
import { formDataToObject, runAction } from "./run-action";

export async function requestBudgetChangeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async (actor) => {
    const input = budgetChangeInputSchema.parse(formDataToObject(formData));
    await getServices().approvals.requestBudgetChange(actor, {
      campaignId: input.campaignId,
      proposedDailyBudgetMajor: input.proposedDailyBudget,
      rationale: input.rationale,
    });
    return { code: "BUDGET_REQUESTED" };
  });
}

export async function requestCreativePublishAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async (actor) => {
    const input = creativePublishInputSchema.parse(formDataToObject(formData));
    await getServices().approvals.requestCreativePublish(actor, input);
    return { code: "PUBLISH_REQUESTED" };
  });
}

export async function approveAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async (actor) => {
    const input = reviewInputSchema.parse(formDataToObject(formData));
    await getServices().approvals.approve(actor, input.approvalId, input.note);
    return { code: "APPROVED" };
  });
}

export async function rejectAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async (actor) => {
    const input = rejectInputSchema.parse(formDataToObject(formData));
    await getServices().approvals.reject(actor, input.approvalId, input.note);
    return { code: "REJECTED" };
  });
}

export async function cancelAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async (actor) => {
    const input = approvalIdInputSchema.parse(formDataToObject(formData));
    await getServices().approvals.cancel(actor, input.approvalId);
    return { code: "CANCELLED" };
  });
}

/** Runs an APPROVED request as a simulation (phase 1 never calls a live API). */
export async function executeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async (actor) => {
    const input = approvalIdInputSchema.parse(formDataToObject(formData));
    const finished = await getServices().approvals.execute(actor, input.approvalId);
    return { code: finished.status === "EXECUTED" ? "EXECUTED_SIMULATED" : "EXECUTION_FAILED" };
  });
}

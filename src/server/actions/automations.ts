"use server";

import { toggleAutomationInputSchema } from "@/domain/approvals/schemas";
import { getServices } from "@/server/services";

import type { ActionResult } from "./result";
import { formDataToObject, runAction } from "./run-action";

export async function toggleAutomationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async (actor) => {
    const input = toggleAutomationInputSchema.parse(formDataToObject(formData));
    await getServices().automations.setEnabled(actor, input.automationId, input.enabled);
    return { code: "AUTOMATION_TOGGLED" };
  });
}

/** Evaluates enabled rules and files PENDING approval requests. Executes nothing. */
export async function evaluateAutomationsAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  return runAction(async (actor) => {
    const summary = await getServices().automations.evaluateAll(actor);
    return {
      code: "AUTOMATIONS_EVALUATED",
      params: { created: summary.proposalsCreated, skipped: summary.skippedExisting + summary.skippedGuardrail },
    };
  });
}

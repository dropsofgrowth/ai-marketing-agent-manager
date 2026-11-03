import type { ApprovalRequest, ExecutionResult } from "@/domain/types";
import type { MutationOptions, MutationResult } from "@/integrations/types";
import type { Integrations } from "@/integrations/registry";

/**
 * Carries out an APPROVED request through the integration adapters.
 *
 * PHASE 1 GUARANTEE: every call is a dry run against the resolved adapters, which
 * are all mocks. No request leaves this server. If an adapter ever reports a
 * non-simulated result, execution is recorded as FAILED rather than trusted.
 */
export async function runApprovedChange(
  request: ApprovalRequest,
  integrations: Integrations,
  options: { now: Date; liveExecutionRequested: boolean },
): Promise<ExecutionResult> {
  const dryRun: MutationOptions = { dryRun: true };
  let result: MutationResult;

  try {
    if (request.type === "BUDGET_CHANGE") {
      result = await integrations.metaAds.updateCampaignBudget(
        { campaignId: request.payload.campaignId, newDailyBudgetMinor: request.payload.proposedDailyBudgetMinor },
        dryRun,
      );
    } else {
      result = await integrations.metaAds.publishCreative(
        {
          campaignId: request.payload.campaignId,
          creative: {
            id: request.payload.creativeId,
            title: request.payload.creativeTitle,
            format: request.payload.format,
            headline: request.payload.headline,
            primaryText: request.payload.primaryText,
            callToAction: request.payload.callToAction,
            assetUrl: null,
          },
        },
        dryRun,
      );
    }
  } catch (error) {
    return {
      ok: false,
      simulated: true,
      operation: request.type === "BUDGET_CHANGE" ? "meta.campaign.update_budget" : "meta.ad.create",
      message: error instanceof Error ? error.message : "Adapter error",
      at: options.now.toISOString(),
    };
  }

  if (!result.simulated) {
    return {
      ok: false,
      simulated: true,
      operation: result.operation,
      message: "Refused: adapter reported a live mutation, which phase 1 does not allow.",
      at: options.now.toISOString(),
    };
  }

  return {
    ok: result.ok,
    simulated: true,
    operation: result.operation,
    message: result.message,
    at: options.now.toISOString(),
    ...(options.liveExecutionRequested ? { liveRequestedButUnavailable: true } : {}),
    details: { ...(result.details ?? {}), ...(result.externalRef ? { externalRef: result.externalRef } : {}) },
  };
}

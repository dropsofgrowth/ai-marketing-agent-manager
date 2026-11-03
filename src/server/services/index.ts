import "server-only";

import { toMinorUnits } from "@/domain/money";
import { getIntegrations } from "@/integrations/registry";
import { getEnv } from "@/server/env";
import { DEMO_WORKSPACE } from "@/server/store/demo-data";
import { getStore } from "@/server/store";

import { createApprovalService, type ApprovalConfig } from "./approvals";
import { createAutomationService } from "./automations";
import { createCreativeService } from "./creatives";

export function getApprovalConfig(): ApprovalConfig {
  const env = getEnv();
  return {
    guardrails: {
      maxIncreasePercent: env.BUDGET_MAX_INCREASE_PERCENT,
      maxDecreasePercent: env.BUDGET_MAX_DECREASE_PERCENT,
      maxDailyBudgetMinor: toMinorUnits(env.BUDGET_MAX_DAILY_AMOUNT, DEMO_WORKSPACE.currency),
    },
    ttlHours: env.APPROVAL_TTL_HOURS,
    requireSeparateApprover: env.REQUIRE_SEPARATE_APPROVER,
    liveExecutionRequested: env.LIVE_EXECUTION_ENABLED,
  };
}

export function getServices() {
  const store = getStore();
  const integrations = getIntegrations();
  const config = getApprovalConfig();
  const now = () => new Date();

  const approvals = createApprovalService({ store, integrations, config, now });
  return {
    store,
    integrations,
    config,
    approvals,
    automations: createAutomationService({ store, integrations, approvals, config, now }),
    creatives: createCreativeService({ store, integrations }),
  };
}

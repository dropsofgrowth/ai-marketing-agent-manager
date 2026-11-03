import type { IntegrationProviderId } from "@/domain/types";

export type { DateRange } from "@/lib/dates";

/**
 * "mock" adapters return deterministic sample data and never call an external API.
 * "live" adapters are not implemented in phase 1.
 */
export type IntegrationMode = "mock" | "live";

export type IntegrationInfo = {
  provider: IntegrationProviderId;
  mode: IntegrationMode;
};

/**
 * Options for any call that would change state on an external platform.
 *
 * `dryRun` is typed as the literal `true`: in phase 1 it is impossible to compile
 * a call that asks an adapter to perform a real change.
 */
export type MutationOptions = {
  dryRun: true;
};

export type MutationResult = {
  ok: boolean;
  simulated: boolean;
  operation: string;
  message: string;
  externalRef?: string;
  details?: Record<string, string | number | boolean | null>;
};

export class IntegrationNotConfiguredError extends Error {
  constructor(provider: IntegrationProviderId) {
    super(`${provider} live adapter is not configured`);
    this.name = "IntegrationNotConfiguredError";
  }
}

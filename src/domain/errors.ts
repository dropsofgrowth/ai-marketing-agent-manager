export const DOMAIN_ERROR_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "INVALID_TRANSITION",
  "CONFLICT",
  "EXPIRED",
  "DUPLICATE_OPEN_REQUEST",
  "GUARDRAIL_NO_CHANGE",
  "GUARDRAIL_NON_POSITIVE",
  "GUARDRAIL_MAX_INCREASE",
  "GUARDRAIL_MAX_DECREASE",
  "GUARDRAIL_DAILY_CAP",
  "SELF_APPROVAL_FORBIDDEN",
  "CREATIVE_NOT_READY",
  "CAMPAIGN_NOT_ACTIVE",
  "STORAGE_UNAVAILABLE",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/**
 * Expected, user-facing failure. `code` is translated in the UI; `params` carries
 * safe interpolation values (never secrets or stack traces).
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly params: Record<string, string | number>;

  constructor(code: DomainErrorCode, params: Record<string, string | number> = {}, message?: string) {
    super(message ?? code);
    this.name = "DomainError";
    this.code = code;
    this.params = params;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

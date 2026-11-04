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
  /** Shopify app credentials (client id/secret/store domain) are not set. */
  "SHOPIFY_NOT_CONFIGURED",
  /** Connecting needs PostgreSQL + a valid CREDENTIALS_ENCRYPTION_KEY to store the token. */
  "SHOPIFY_STORAGE_REQUIRED",
  /** The dashboard was opened on a different address than APP_URL (OAuth would fail). */
  "SHOPIFY_APP_URL_MISMATCH",
  "SHOPIFY_NOT_CONNECTED",
  /** Token revoked/expired beyond refresh, or the app was uninstalled. */
  "SHOPIFY_RECONNECT_REQUIRED",
  /** Shopify could not be reached or returned an error; nothing was changed. */
  "SHOPIFY_UNAVAILABLE",
  "SHOPIFY_MISSING_SCOPES",
  /** The installed app was granted write access; phase 2 accepts read-only access only. */
  "SHOPIFY_WRITE_SCOPES_GRANTED",
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

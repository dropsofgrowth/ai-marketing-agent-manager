/**
 * Minimal structured logging for integration code.
 *
 * Rules (enforced here, not left to call sites):
 * - Only flat primitive fields are logged — no request/response bodies, headers or
 *   error objects, which could carry tokens or customer data.
 * - Every string is passed through `redactSecrets` as a last line of defence.
 * - Keys that look secret-bearing are dropped entirely.
 */

export type LogFields = Record<string, string | number | boolean | null | undefined>;
type Level = "info" | "warn" | "error";

/** Shopify token prefixes (shpat_, shpua_, shpca_, shprt_, …), bearer values and long opaque strings. */
const SECRET_PATTERNS: RegExp[] = [
  /\bshp[a-z]{2}_[A-Za-z0-9_-]+/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(access_token|refresh_token|client_secret|code|hmac|state)=([^&\s]+)/gi,
];

const SECRET_KEY = /(token|secret|password|authorization|cookie|hmac|code|state|credential)/i;
/** Keys that match SECRET_KEY by name but only ever hold short, safe codes. */
const ALLOWED_KEYS = new Set(["errorCode", "graphqlCode"]);

export function redactSecrets(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, p1: string | undefined) =>
      p1 && match.includes("=") ? `${p1}=[redacted]` : p1 && /bearer|basic/i.test(p1) ? `${p1} [redacted]` : "[redacted]",
    );
  }
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

export function sanitizeFields(fields: LogFields): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SECRET_KEY.test(key) && !ALLOWED_KEYS.has(key)) continue;
    safe[key] = typeof value === "string" ? redactSecrets(value) : value;
  }
  return safe;
}

export type Logger = (level: Level, event: string, fields?: LogFields) => void;

export const log: Logger = (level, event, fields = {}) => {
  const line = JSON.stringify({ level, event, ...sanitizeFields(fields), at: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};

/** A logger that records nothing (tests) or collects lines for assertions. */
export function createMemoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const logger = ((level: Level, event: string, fields: LogFields = {}) => {
    lines.push(JSON.stringify({ level, event, ...sanitizeFields(fields) }));
  }) as Logger & { lines: string[] };
  logger.lines = lines;
  return logger;
}

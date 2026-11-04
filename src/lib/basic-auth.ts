/**
 * Dashboard access (HTTP Basic Auth) — shared by the proxy and the server-side
 * guard. Pure and runtime-agnostic (Web Crypto only): no env reads, no Next.js APIs.
 *
 * Policy (fail closed, independent of how the server was started):
 * - DASHBOARD_BASIC_AUTH_USER and DASHBOARD_BASIC_AUTH_PASSWORD are REQUIRED and must
 *   be valid; otherwise every request is refused — in production, test, or any other mode.
 * - The only way to run without them ("open") is an explicit opt-in for local work:
 *   DASHBOARD_AUTH_DISABLED=1 together with NODE_ENV=development (`next dev`) and no
 *   credentials configured. The flag anywhere else — or with another value — is itself
 *   a misconfiguration and refuses every request. Live store data additionally requires
 *   credentials even in open mode (see Shopify readiness).
 */

export const DASHBOARD_AUTH_VARS = ["DASHBOARD_BASIC_AUTH_USER", "DASHBOARD_BASIC_AUTH_PASSWORD"] as const;
export const DASHBOARD_AUTH_DISABLED_VAR = "DASHBOARD_AUTH_DISABLED";
export const MIN_PASSWORD_LENGTH = 12;
const MAX_LENGTH = 256;

export type DashboardAuthProblem =
  | "missing_user"
  | "missing_password"
  /** Empty, too long, contains ":" (the Basic Auth separator) or control characters. */
  | "invalid_user"
  | "password_too_short"
  | "invalid_password"
  /** DASHBOARD_AUTH_DISABLED set outside `next dev`, or to anything but "1". */
  | "disable_flag_not_allowed";

export type DashboardAuth =
  | { mode: "required"; user: string; password: string }
  /** Explicit DASHBOARD_AUTH_DISABLED=1 under `next dev`, with no credentials configured. */
  | { mode: "open" }
  | { mode: "misconfigured"; problems: DashboardAuthProblem[] };

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const blank = (value: string | undefined) => value === undefined || value.trim() === "";

export function evaluateDashboardAuth(input: {
  user: string | undefined;
  password: string | undefined;
  /** Raw DASHBOARD_AUTH_DISABLED value (undefined when unset or empty). */
  disableFlag: string | undefined;
  /** True only for NODE_ENV=development. */
  development: boolean;
}): DashboardAuth {
  const { user, password, disableFlag, development } = input;
  const noCredentials = blank(user) && blank(password);
  if (!blank(disableFlag)) {
    if (!development || disableFlag!.trim() !== "1") return { mode: "misconfigured", problems: ["disable_flag_not_allowed"] };
    // Configured credentials always apply; the flag only lets a bare local checkout run.
    if (noCredentials) return { mode: "open" };
  }
  if (noCredentials) return { mode: "misconfigured", problems: ["missing_user", "missing_password"] };

  const problems: DashboardAuthProblem[] = [];
  if (blank(user)) problems.push("missing_user");
  else if (user!.includes(":") || CONTROL_CHARS.test(user!) || user!.length > 128) problems.push("invalid_user");
  if (blank(password)) problems.push("missing_password");
  else if (password!.length < MIN_PASSWORD_LENGTH) problems.push("password_too_short");
  else if (CONTROL_CHARS.test(password!) || password!.length > MAX_LENGTH) problems.push("invalid_password");

  return problems.length ? { mode: "misconfigured", problems } : { mode: "required", user: user!, password: password! };
}

/** Operator-facing explanation (variable NAMES and rules only — never values). */
export function describeAuthProblems(problems: readonly DashboardAuthProblem[]): string {
  const parts = problems.map((problem) => {
    switch (problem) {
      case "missing_user":
        return "DASHBOARD_BASIC_AUTH_USER is not set";
      case "missing_password":
        return "DASHBOARD_BASIC_AUTH_PASSWORD is not set";
      case "invalid_user":
        return "DASHBOARD_BASIC_AUTH_USER must be 1–128 characters without ':'";
      case "password_too_short":
        return `DASHBOARD_BASIC_AUTH_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`;
      case "invalid_password":
        return `DASHBOARD_BASIC_AUTH_PASSWORD must be ${MIN_PASSWORD_LENGTH}–${MAX_LENGTH} printable characters`;
      case "disable_flag_not_allowed":
        return "DASHBOARD_AUTH_DISABLED is only allowed as DASHBOARD_AUTH_DISABLED=1 with `next dev` (NODE_ENV=development) — remove it";
    }
  });
  const hint = problems.includes("missing_user") && problems.includes("missing_password")
    ? " (for local development only, `next dev` can run without them with DASHBOARD_AUTH_DISABLED=1)"
    : "";
  return `Dashboard access is not configured: ${parts.join("; ")}${hint}.`;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** Constant-time comparison of two strings via their SHA-256 digests. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

/** Decodes standard base64 to UTF-8 (so non-ASCII passwords work), or null if malformed. */
function decodeBase64Utf8(value: string): string | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** True when `header` is `Basic base64(user:password)` matching the expected credentials. */
export async function verifyBasicAuthHeader(
  header: string | null | undefined,
  expected: { user: string; password: string },
): Promise<boolean> {
  const match = /^Basic\s+(\S+)\s*$/i.exec(header ?? "");
  if (!match) return false;
  const decoded = decodeBase64Utf8(match[1]);
  if (decoded === null) return false;
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const [userOk, passOk] = await Promise.all([
    safeEqual(decoded.slice(0, separator), expected.user),
    safeEqual(decoded.slice(separator + 1), expected.password),
  ]);
  return userOk && passOk;
}

import "server-only";

import { headers } from "next/headers";

import { DomainError } from "@/domain/errors";
import { verifyBasicAuthHeader } from "@/lib/basic-auth";
import { getDashboardAuth } from "@/server/env";

/**
 * Server-side dashboard access check — the second layer behind the proxy.
 *
 * The proxy (src/proxy.ts) already refuses unauthenticated requests, but a proxy
 * can be skipped (a matcher mistake, a framework bug such as the 2025
 * `x-middleware-subrequest` bypass, or a new route outside its matcher). This
 * re-verifies the same credentials from the request itself, and
 * `getCurrentActor()` calls it, so no page, server action or route can obtain an
 * identity — and therefore any workspace data — without them.
 *
 * Fails closed: an invalid or unparseable configuration is refused.
 */
export async function requireDashboardAccess(): Promise<void> {
  let auth: ReturnType<typeof getDashboardAuth>;
  try {
    auth = getDashboardAuth();
  } catch {
    throw new DomainError("DASHBOARD_ACCESS_NOT_CONFIGURED");
  }
  if (auth.mode === "misconfigured") throw new DomainError("DASHBOARD_ACCESS_NOT_CONFIGURED");
  if (auth.mode === "open") return; // development/test with no credentials configured at all

  const authorization = (await headers()).get("authorization");
  if (!(await verifyBasicAuthHeader(authorization, auth))) throw new DomainError("UNAUTHENTICATED");
}

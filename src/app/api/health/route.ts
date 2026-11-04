import { connection } from "next/server";

import { getDashboardAuth } from "@/server/env";
import { getStore } from "@/server/store";

/**
 * Liveness/readiness probe for load balancers and uptime checks.
 * Reports storage reachability and whether dashboard access is configured (the
 * dashboard refuses every request when it isn't) — never configuration values.
 */
export async function GET() {
  await connection();
  const store = getStore();
  let storage: "ok" | "error" = "ok";
  try {
    await store.ping();
  } catch {
    storage = "error";
  }
  let access: "ok" | "not_configured" = "ok";
  try {
    if (getDashboardAuth().mode === "misconfigured") access = "not_configured";
  } catch {
    access = "not_configured";
  }
  const ok = storage === "ok" && access === "ok";
  return Response.json(
    // Integration/connection state is deliberately not exposed on this public endpoint.
    { status: ok ? "ok" : "degraded", storage: { kind: store.kind, status: storage }, access },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

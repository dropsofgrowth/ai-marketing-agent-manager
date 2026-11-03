import { connection } from "next/server";

import { getStore } from "@/server/store";

/**
 * Liveness/readiness probe for load balancers and uptime checks.
 * Reports storage kind and reachability only — no configuration values.
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
  const ok = storage === "ok";
  return Response.json(
    { status: ok ? "ok" : "degraded", storage: { kind: store.kind, status: storage }, integrations: "mock" },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

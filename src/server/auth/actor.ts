import "server-only";

import type { Actor } from "@/domain/types";
import { getPrisma } from "@/server/db/prisma";
import { getEnv } from "@/server/env";
import { DEMO_USER, DEMO_WORKSPACE } from "@/server/store/demo-data";

/**
 * PHASE 1 PLACEHOLDER — there is no end-user authentication yet.
 *
 * Every request acts as a single demo operator with the OWNER role. Before this
 * dashboard is exposed beyond a trusted preview (see DASHBOARD_BASIC_AUTH_* for a
 * stop-gap), replace this with a real session lookup (e.g. Auth.js / SSO) that
 * resolves the user's workspace membership and role from the database.
 *
 * All authorization decisions already go through `assertPermission(actor, …)`,
 * so swapping this function is the only change needed to enforce real roles.
 */
const DEMO_ACTOR: Actor = {
  userId: DEMO_USER.id,
  workspaceId: DEMO_WORKSPACE.id,
  name: DEMO_USER.name,
  role: "OWNER",
};

const globalForActor = globalThis as unknown as { __demoTenantReady?: Promise<void> };

/** Makes sure the demo workspace/user rows exist so foreign keys resolve. */
async function ensureDemoTenant(databaseUrl: string) {
  const prisma = getPrisma(databaseUrl);
  await prisma.$transaction([
    prisma.workspace.upsert({
      where: { id: DEMO_WORKSPACE.id },
      update: {},
      create: { ...DEMO_WORKSPACE },
    }),
    prisma.user.upsert({ where: { id: DEMO_USER.id }, update: {}, create: { ...DEMO_USER } }),
    prisma.membership.upsert({
      where: { workspaceId_userId: { workspaceId: DEMO_WORKSPACE.id, userId: DEMO_USER.id } },
      update: {},
      create: { workspaceId: DEMO_WORKSPACE.id, userId: DEMO_USER.id, role: "OWNER" },
    }),
  ]);
}

export async function getCurrentActor(): Promise<Actor> {
  const { DATABASE_URL } = getEnv();
  if (DATABASE_URL) {
    globalForActor.__demoTenantReady ??= ensureDemoTenant(DATABASE_URL).catch((error) => {
      globalForActor.__demoTenantReady = undefined; // retry on the next request
      throw error;
    });
    await globalForActor.__demoTenantReady;
  }
  return DEMO_ACTOR;
}

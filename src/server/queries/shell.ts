import "server-only";

import { cache } from "react";

import { getCurrentActor } from "@/server/auth/actor";
import { getStore } from "@/server/store";

/** Pending-approval count for the nav badge. Returns null if storage is unreachable. */
export const getPendingCount = cache(async (): Promise<number | null> => {
  try {
    const actor = await getCurrentActor();
    const counts = await getStore().approvals.countByStatus(actor.workspaceId);
    return counts.PENDING;
  } catch (error) {
    console.error("[shell] could not load pending count", error);
    return null;
  }
});

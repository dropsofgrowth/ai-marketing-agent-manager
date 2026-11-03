import "server-only";

import { getPrisma } from "@/server/db/prisma";
import { getEnv } from "@/server/env";

import { buildDemoData } from "./demo-data";
import { createMemoryStore } from "./memory-store";
import { createPrismaStore } from "./prisma-store";
import type { DataStore } from "./types";

const globalForStore = globalThis as unknown as {
  __memoryStore?: DataStore;
  __prismaStore?: DataStore;
};

/**
 * PostgreSQL (via Prisma) when DATABASE_URL is set; otherwise an in-memory store
 * pre-filled with demo data so the dashboard can be previewed with zero setup.
 */
export function getStore(): DataStore {
  const env = getEnv();
  if (env.DATABASE_URL) {
    globalForStore.__prismaStore ??= createPrismaStore(getPrisma(env.DATABASE_URL));
    return globalForStore.__prismaStore;
  }
  globalForStore.__memoryStore ??= createMemoryStore(buildDemoData(new Date(), env.APPROVAL_TTL_HOURS));
  return globalForStore.__memoryStore;
}

export type { DataStore } from "./types";

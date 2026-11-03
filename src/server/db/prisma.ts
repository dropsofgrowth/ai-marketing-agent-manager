import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

/** One PrismaClient per process (survives dev-server hot reloads). */
export function getPrisma(databaseUrl: string): PrismaClient {
  globalForPrisma.__prisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  return globalForPrisma.__prisma;
}

/**
 * Seeds the demo workspace with sample approvals, creatives, automations and
 * audit entries. Idempotent: sample content is only inserted when the demo
 * workspace has no approval requests yet, so it never overwrites your data.
 *
 *   npm run db:seed
 */
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { DEMO_USER, DEMO_WORKSPACE, buildDemoData } from "../src/server/store/demo-data";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and configure it first.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
/** Required JSON column. */
const json = (v: unknown) => v as Prisma.InputJsonValue;
/** Nullable JSON column: SQL NULL when absent. */
const nullableJson = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));

async function main() {
  await prisma.workspace.upsert({ where: { id: DEMO_WORKSPACE.id }, update: {}, create: { ...DEMO_WORKSPACE } });
  await prisma.user.upsert({ where: { id: DEMO_USER.id }, update: {}, create: { ...DEMO_USER } });
  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: DEMO_WORKSPACE.id, userId: DEMO_USER.id } },
    update: {},
    create: { workspaceId: DEMO_WORKSPACE.id, userId: DEMO_USER.id, role: "OWNER" },
  });

  const existing = await prisma.approvalRequest.count({ where: { workspaceId: DEMO_WORKSPACE.id } });
  if (existing > 0) {
    console.log(`Demo workspace already has ${existing} approval request(s); skipping sample content.`);
    return;
  }

  const ttlHours = Number(process.env.APPROVAL_TTL_HOURS) || 72;
  const demo = buildDemoData(new Date(), ttlHours);

  await prisma.$transaction(async (tx) => {
    await tx.automation.createMany({
      data: demo.automations.map((a) => ({ ...a, config: json(a.config) })),
      skipDuplicates: true,
    });
    await tx.creative.createMany({
      data: demo.creatives.map((c) => ({ ...c, metadata: nullableJson(c.metadata) })),
      skipDuplicates: true,
    });
    await tx.approvalRequest.createMany({
      data: demo.approvals.map((a) => ({
        ...a,
        payload: json(a.payload),
        executionResult: nullableJson(a.executionResult),
      })),
      skipDuplicates: true,
    });
    await tx.auditLog.createMany({
      data: demo.audit.map((e) => ({ ...e, metadata: nullableJson(e.metadata) })),
      skipDuplicates: true,
    });
  });

  console.log(
    `Seeded ${demo.approvals.length} approvals, ${demo.creatives.length} creatives, ` +
      `${demo.automations.length} automations and ${demo.audit.length} audit entries.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

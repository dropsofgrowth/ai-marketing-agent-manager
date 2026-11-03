import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 does not load .env files automatically. Mirror Next.js precedence:
// values in .env.local win over .env.
loadEnv({ path: [".env.local", ".env"], quiet: true });

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // `prisma generate` does not need a database, so the URL is only attached when
  // present. Migration commands fail with a clear error if DATABASE_URL is missing.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});

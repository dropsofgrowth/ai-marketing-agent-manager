import "server-only";

import { z } from "zod";

import { evaluateDashboardAuth, type DashboardAuth } from "@/lib/basic-auth";

/**
 * Server-only, validated environment configuration.
 *
 * - Parsed lazily (first call) so `next build` works without a populated .env.
 * - Secret values are never returned to the client; use `getIntegrationEnvStatus`
 *   to expose *presence* only.
 */

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());

const booleanFlag = (defaultValue: boolean) =>
  z.preprocess(
    (value) => {
      const v = emptyToUndefined(value);
      if (v === undefined) return defaultValue;
      if (typeof v === "string") return ["1", "true", "yes", "on"].includes(v.toLowerCase());
      return v;
    },
    z.boolean(),
  );

const positiveNumber = (defaultValue: number, max: number) =>
  z.preprocess(
    (value) => emptyToUndefined(value) ?? defaultValue,
    z.coerce.number().positive().max(max),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.preprocess(emptyToUndefined, z.url().default("http://localhost:3000")),
  DEFAULT_LOCALE: z.preprocess(emptyToUndefined, z.enum(["en", "ar"]).default("en")),

  DATABASE_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .refine((v) => /^postgres(ql)?:\/\//.test(v), "DATABASE_URL must be a postgres:// URL")
      .optional(),
  ),

  CREDENTIALS_ENCRYPTION_KEY: optionalString,
  // Validated by evaluateDashboardAuth (required in production; see getDashboardAuth).
  // Kept lenient here so a bad value fails closed with a clear 503, not a crash.
  DASHBOARD_BASIC_AUTH_USER: z.preprocess(emptyToUndefined, z.string().optional()),
  DASHBOARD_BASIC_AUTH_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),

  LIVE_EXECUTION_ENABLED: booleanFlag(false),
  BUDGET_MAX_INCREASE_PERCENT: positiveNumber(50, 1000),
  BUDGET_MAX_DECREASE_PERCENT: positiveNumber(80, 100),
  BUDGET_MAX_DAILY_AMOUNT: positiveNumber(5000, 10_000_000),
  APPROVAL_TTL_HOURS: positiveNumber(72, 24 * 30),
  REQUIRE_SEPARATE_APPROVER: booleanFlag(false),

  META_APP_ID: optionalString,
  META_APP_SECRET: optionalString,
  META_ACCESS_TOKEN: optionalString,
  META_AD_ACCOUNT_ID: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^act_\d+$/, "META_AD_ACCOUNT_ID must look like act_1234567890")
      .optional(),
  ),
  META_API_VERSION: optionalString,

  /** Dev Dashboard app "Client ID" (public identifier, but still kept server-side). */
  SHOPIFY_CLIENT_ID: optionalString,
  /** Dev Dashboard app "Secret". Signs OAuth callbacks and redeems/refreshes tokens. Never sent to the browser. */
  SHOPIFY_CLIENT_SECRET: optionalString,
  /** The one store this deployment may connect to, e.g. drops-of-growth.myshopify.com. */
  SHOPIFY_STORE_DOMAIN: z.preprocess(
    (value) => (typeof emptyToUndefined(value) === "string" ? String(value).trim().toLowerCase() : undefined),
    z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, "SHOPIFY_STORE_DOMAIN must be <store>.myshopify.com")
      .optional(),
  ),
  /** Pinned Admin API version (YYYY-01|04|07|10). Bump deliberately after testing. */
  SHOPIFY_API_VERSION: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d{4}-(01|04|07|10)$/, "SHOPIFY_API_VERSION must look like 2026-10")
      .default("2026-10"),
  ),

  HIGGSFIELD_API_KEY: optionalString,
  HIGGSFIELD_API_SECRET: optionalString,
  HIGGSFIELD_API_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Only variable names and messages are printed — never values.
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached parse so a test can change process.env. */
export function resetEnvCacheForTests() {
  cached = undefined;
}

/** Dashboard access policy from the environment (see src/lib/basic-auth.ts). */
export function getDashboardAuth(env: ServerEnv = getEnv()): DashboardAuth {
  return evaluateDashboardAuth({
    user: env.DASHBOARD_BASIC_AUTH_USER,
    password: env.DASHBOARD_BASIC_AUTH_PASSWORD,
    production: env.NODE_ENV === "production",
  });
}

export type IntegrationEnvStatus = {
  metaAds: { credentialsPresent: boolean; missing: string[] };
  shopify: { credentialsPresent: boolean; missing: string[] };
  higgsfield: { credentialsPresent: boolean; missing: string[] };
};

/** Reports which credentials are present without ever exposing their values. */
export function getIntegrationEnvStatus(env: ServerEnv = getEnv()): IntegrationEnvStatus {
  const check = (keys: (keyof ServerEnv)[]) => {
    const missing = keys.filter((key) => !env[key]).map(String);
    return { credentialsPresent: missing.length === 0, missing };
  };
  return {
    metaAds: check(["META_APP_ID", "META_APP_SECRET", "META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"]),
    shopify: check(["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_STORE_DOMAIN"]),
    higgsfield: check(["HIGGSFIELD_API_KEY", "HIGGSFIELD_API_SECRET", "HIGGSFIELD_API_BASE_URL"]),
  };
}

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";
import { resetEnvCacheForTests } from "@/server/env";

const USER = "owner";
const PASSWORD = "a-long-test-password";
const authHeader = (user = USER, password = PASSWORD) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

function configure(env: Record<string, string | undefined>) {
  vi.unstubAllEnvs();
  vi.stubEnv("DASHBOARD_BASIC_AUTH_USER", "");
  vi.stubEnv("DASHBOARD_BASIC_AUTH_PASSWORD", "");
  vi.stubEnv("DATABASE_URL", "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value ?? "");
  resetEnvCacheForTests();
}

function run(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return proxy(new NextRequest(new URL(path, "https://dash.example.com"), init));
}

const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

const PROTECTED = [
  "/en/settings",
  "/en/shopify",
  "/ar/approvals",
  "/en/a.b",
  "/api/integrations/shopify/callback?code=x&state=y",
  "/api/anything",
];

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
});

describe("proxy: production without valid credentials fails closed", () => {
  it.each([
    ["both missing", {}],
    ["password missing", { DASHBOARD_BASIC_AUTH_USER: USER }],
    ["user missing", { DASHBOARD_BASIC_AUTH_PASSWORD: PASSWORD }],
    ["password too short", { DASHBOARD_BASIC_AUTH_USER: USER, DASHBOARD_BASIC_AUTH_PASSWORD: "short" }],
    ["user with ':'", { DASHBOARD_BASIC_AUTH_USER: "a:b", DASHBOARD_BASIC_AUTH_PASSWORD: PASSWORD }],
  ])("%s → 503 for every protected path, even with an Authorization header", async (_label, env) => {
    configure({ NODE_ENV: "production", ...env });
    for (const path of PROTECTED) {
      const res = await run(path, { headers: { authorization: authHeader() } });
      expect(res.status, path).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.text();
      expect(body).toContain("Dashboard access is not configured");
      expect(body).not.toContain(PASSWORD);
    }
    const action = await run("/en/settings", { method: "POST", headers: { "next-action": "abc" } });
    expect(action.status).toBe(503);
  });
});

describe("proxy: credentials configured", () => {
  const env = { NODE_ENV: "production", DASHBOARD_BASIC_AUTH_USER: USER, DASHBOARD_BASIC_AUTH_PASSWORD: PASSWORD };

  it("rejects missing or wrong credentials with a 401 challenge", async () => {
    configure(env);
    const attempts: Record<string, string>[] = [
      {},
      { authorization: authHeader(USER, "wrong-password-1234") },
      { authorization: "Bearer x" },
    ];
    for (const headers of attempts) {
      for (const path of PROTECTED) {
        const res = await run(path, { headers });
        expect(res.status, path).toBe(401);
        expect(res.headers.get("www-authenticate")).toContain("Basic");
      }
    }
    // Framework-internal headers don't skip the check.
    const spoofed = await run("/en/settings", { headers: { "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy" } });
    expect(spoofed.status).toBe(401);
  });

  it("lets valid credentials through, without localizing API routes", async () => {
    configure(env);
    const headers = { authorization: authHeader() };
    expect(passedThrough(await run("/en/settings", { headers }))).toBe(true);
    expect(passedThrough(await run("/api/integrations/shopify/callback?state=x", { headers }))).toBe(true);
    const root = await run("/", { headers: { ...headers, "accept-language": "ar" } });
    expect(root.status).toBe(307);
    expect(root.headers.get("location")).toBe("https://dash.example.com/ar");
  });
});

describe("proxy: development", () => {
  it("runs open only when no credentials are configured at all", async () => {
    configure({ NODE_ENV: "development" });
    expect(passedThrough(await run("/en/settings"))).toBe(true);

    configure({ NODE_ENV: "development", DASHBOARD_BASIC_AUTH_USER: USER });
    expect((await run("/en/settings")).status).toBe(503);

    configure({ NODE_ENV: "development", DASHBOARD_BASIC_AUTH_USER: USER, DASHBOARD_BASIC_AUTH_PASSWORD: PASSWORD });
    expect((await run("/en/settings")).status).toBe(401);
  });
});

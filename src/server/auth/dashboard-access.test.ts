/**
 * The server-side access check behind the proxy: even if a request reached a page,
 * server action or route WITHOUT passing the proxy, it gets no identity (and so no
 * workspace or store data) unless it carries the dashboard credentials.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/domain/errors";
import { resetEnvCacheForTests } from "@/server/env";

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));

const { requireDashboardAccess } = await import("./dashboard-access");
const { getCurrentActor } = await import("./actor");

const USER = "owner";
const PASSWORD = "a-long-test-password";
const auth = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

function configure(env: Record<string, string>) {
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DASHBOARD_BASIC_AUTH_USER", "");
  vi.stubEnv("DASHBOARD_BASIC_AUTH_PASSWORD", "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  resetEnvCacheForTests();
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof DomainError && e.code === code);
}

beforeEach(() => {
  requestHeaders = new Headers();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
});

describe("server-side dashboard access", () => {
  it("fails closed in production when credentials are missing or invalid", async () => {
    configure({ NODE_ENV: "production" });
    requestHeaders.set("authorization", auth(USER, PASSWORD));
    await expectCode(requireDashboardAccess(), "DASHBOARD_ACCESS_NOT_CONFIGURED");
    await expectCode(getCurrentActor(), "DASHBOARD_ACCESS_NOT_CONFIGURED");

    configure({ NODE_ENV: "production", DASHBOARD_BASIC_AUTH_USER: USER, DASHBOARD_BASIC_AUTH_PASSWORD: "short" });
    await expectCode(getCurrentActor(), "DASHBOARD_ACCESS_NOT_CONFIGURED");
  });

  it("gives no identity to unauthenticated or wrongly authenticated requests", async () => {
    configure({ NODE_ENV: "production", DASHBOARD_BASIC_AUTH_USER: USER, DASHBOARD_BASIC_AUTH_PASSWORD: PASSWORD });
    await expectCode(getCurrentActor(), "UNAUTHENTICATED");
    requestHeaders.set("authorization", auth(USER, "wrong-password-1234"));
    await expectCode(getCurrentActor(), "UNAUTHENTICATED");
    requestHeaders.set("authorization", auth("intruder", PASSWORD));
    await expectCode(getCurrentActor(), "UNAUTHENTICATED");
  });

  it("returns the actor for correctly authenticated requests", async () => {
    configure({ NODE_ENV: "production", DASHBOARD_BASIC_AUTH_USER: USER, DASHBOARD_BASIC_AUTH_PASSWORD: PASSWORD });
    requestHeaders.set("authorization", auth(USER, PASSWORD));
    await expect(requireDashboardAccess()).resolves.toBeUndefined();
    await expect(getCurrentActor()).resolves.toMatchObject({ role: "OWNER" });
  });

  it("is open in development only without any credentials configured", async () => {
    configure({ NODE_ENV: "development" });
    await expect(getCurrentActor()).resolves.toMatchObject({ role: "OWNER" });
    configure({ NODE_ENV: "development", DASHBOARD_BASIC_AUTH_USER: USER, DASHBOARD_BASIC_AUTH_PASSWORD: PASSWORD });
    await expectCode(getCurrentActor(), "UNAUTHENTICATED");
  });
});

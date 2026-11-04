import { describe, expect, it } from "vitest";

import { describeAuthProblems, evaluateDashboardAuth, verifyBasicAuthHeader } from "@/lib/basic-auth";

const basic = (credentials: string) => `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
const GOOD = { user: "owner", password: "a-long-test-password" };

describe("dashboard access policy (fail closed)", () => {
  it("requires credentials in production", () => {
    expect(evaluateDashboardAuth({ user: undefined, password: undefined, production: true })).toEqual({
      mode: "misconfigured",
      problems: ["missing_user", "missing_password"],
    });
    expect(evaluateDashboardAuth({ user: "  ", password: "", production: true }).mode).toBe("misconfigured");
  });

  it("allows an open dashboard only in development/test, and only with no credentials at all", () => {
    expect(evaluateDashboardAuth({ user: undefined, password: undefined, production: false })).toEqual({ mode: "open" });
    // A half configuration is a mistake — refused everywhere.
    expect(evaluateDashboardAuth({ user: "owner", password: undefined, production: false })).toEqual({
      mode: "misconfigured",
      problems: ["missing_password"],
    });
    expect(evaluateDashboardAuth({ user: undefined, password: GOOD.password, production: true })).toEqual({
      mode: "misconfigured",
      problems: ["missing_user"],
    });
  });

  it("rejects invalid credentials instead of using them", () => {
    const check = (user: string, password: string) => evaluateDashboardAuth({ user, password, production: true });
    expect(check("owner", "short")).toEqual({ mode: "misconfigured", problems: ["password_too_short"] });
    expect(check("own:er", GOOD.password)).toEqual({ mode: "misconfigured", problems: ["invalid_user"] });
    expect(check("owner\n", GOOD.password).mode).toBe("misconfigured");
    expect(check("owner", "a-long-password\u0000x").mode).toBe("misconfigured");
    expect(check("owner", "x".repeat(300)).mode).toBe("misconfigured");
    expect(check(GOOD.user, GOOD.password)).toEqual({ mode: "required", ...GOOD });
  });

  it("explains problems by variable name only, never by value", () => {
    const text = describeAuthProblems(["missing_user", "password_too_short"]);
    expect(text).toContain("DASHBOARD_BASIC_AUTH_USER is not set");
    expect(text).toContain("at least 12 characters");
    expect(text).not.toContain(GOOD.password);
  });
});

describe("Basic Auth header verification", () => {
  it("accepts exactly the configured credentials", async () => {
    expect(await verifyBasicAuthHeader(basic("owner:a-long-test-password"), GOOD)).toBe(true);
    expect(await verifyBasicAuthHeader(`basic   ${Buffer.from("owner:a-long-test-password").toString("base64")}`, GOOD)).toBe(true);
    // Passwords may contain ":" and non-ASCII characters.
    expect(await verifyBasicAuthHeader(basic("owner:pa:ss:word-كلمة"), { user: "owner", password: "pa:ss:word-كلمة" })).toBe(true);
  });

  it("rejects missing, malformed and wrong credentials", async () => {
    for (const header of [
      null,
      undefined,
      "",
      "Bearer abc",
      "Basic",
      "Basic !!!not-base64!!!",
      basic("owner"), // no separator
      basic("owner:wrong-password-123"),
      basic("Owner:a-long-test-password"), // case-sensitive user
      basic(":a-long-test-password"),
      basic("owner:a-long-test-password "), // trailing space
      `${basic("owner:a-long-test-password")} extra`,
    ]) {
      expect(await verifyBasicAuthHeader(header, GOOD)).toBe(false);
    }
  });
});

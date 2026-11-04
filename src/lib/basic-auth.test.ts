import { describe, expect, it } from "vitest";

import { describeAuthProblems, evaluateDashboardAuth, verifyBasicAuthHeader } from "@/lib/basic-auth";

const basic = (credentials: string) => `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
const GOOD = { user: "owner", password: "a-long-test-password" };

describe("dashboard access policy (fail closed)", () => {
  const evaluate = (
    user: string | undefined,
    password: string | undefined,
    { development = false, disableFlag }: { development?: boolean; disableFlag?: string } = {},
  ) => evaluateDashboardAuth({ user, password, disableFlag, development });

  it("requires credentials however the server was started (production, test, development)", () => {
    for (const development of [false, true]) {
      expect(evaluate(undefined, undefined, { development })).toEqual({
        mode: "misconfigured",
        problems: ["missing_user", "missing_password"],
      });
      expect(evaluate("  ", "", { development }).mode).toBe("misconfigured");
    }
  });

  it("runs open only with the explicit DASHBOARD_AUTH_DISABLED=1 opt-in under `next dev`, without credentials", () => {
    expect(evaluate(undefined, undefined, { development: true, disableFlag: "1" })).toEqual({ mode: "open" });
    // Configured credentials still apply when the flag is set.
    expect(evaluate(GOOD.user, GOOD.password, { development: true, disableFlag: "1" })).toEqual({ mode: "required", ...GOOD });
    // Outside `next dev`, or with any other value, the flag itself refuses every request.
    for (const [development, disableFlag] of [
      [false, "1"],
      [true, "true"],
      [true, "0"],
      [true, "yes"],
    ] as const) {
      expect(evaluate(undefined, undefined, { development, disableFlag })).toEqual({
        mode: "misconfigured",
        problems: ["disable_flag_not_allowed"],
      });
    }
    expect(evaluate(GOOD.user, GOOD.password, { disableFlag: "1" })).toEqual({
      mode: "misconfigured",
      problems: ["disable_flag_not_allowed"],
    });
  });

  it("refuses a half configuration everywhere", () => {
    expect(evaluate("owner", undefined, { development: true, disableFlag: "1" })).toEqual({
      mode: "misconfigured",
      problems: ["missing_password"],
    });
    expect(evaluate(undefined, GOOD.password)).toEqual({ mode: "misconfigured", problems: ["missing_user"] });
  });

  it("rejects invalid credentials instead of using them", () => {
    const check = (user: string, password: string) => evaluate(user, password);
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
    expect(describeAuthProblems(["missing_user", "missing_password"])).toContain("DASHBOARD_AUTH_DISABLED=1");
    expect(describeAuthProblems(["disable_flag_not_allowed"])).toContain("remove it");
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

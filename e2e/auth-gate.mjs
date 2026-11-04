/**
 * Dashboard access gate check against a running PRODUCTION server (`next start`).
 *
 *   # server started WITH valid DASHBOARD_BASIC_AUTH_USER / _PASSWORD:
 *   BASE_URL=http://localhost:3000 BASIC_AUTH=user:password npm run test:auth-gate
 *   # server started WITHOUT them (or with an invalid password) — must fail closed:
 *   BASE_URL=http://localhost:3000 EXPECT=fail-closed npm run test:auth-gate
 *
 * Without credentials: every page, every dotted variant of a page path (the
 * [lang]/[...rest] catch-all renders the app shell for those), server-action POSTs
 * and API routes other than /api/health must answer 401 — while the data-free
 * public files (PWA manifest, icons, service worker, offline page, Next.js static
 * assets, health probe) must stay reachable, because browsers fetch them without
 * credentials. With credentials, pages and the OAuth callback must work.
 */
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const FAIL_CLOSED = process.env.EXPECT === "fail-closed";
const [user, ...rest] = (process.env.BASIC_AUTH ?? (FAIL_CLOSED ? "anyone:any-password-123" : "")).split(":");
if (!user || !rest.length) {
  console.error("Set BASIC_AUTH=user:password (the server's DASHBOARD_BASIC_AUTH_* values), or EXPECT=fail-closed.");
  process.exit(2);
}
const auth = { authorization: `Basic ${Buffer.from(`${user}:${rest.join(":")}`).toString("base64")}` };
const wrongAuth = { authorization: `Basic ${Buffer.from(`${user}:wrong-password`).toString("base64")}` };

const failures = [];
let checks = 0;
const expectStatus = async (label, path, expected, init = {}) => {
  checks++;
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  const ok = Array.isArray(expected) ? expected.includes(res.status) : res.status === expected;
  if (!ok) failures.push(`${label} ${init.method ?? "GET"} ${path} → ${res.status} (expected ${expected})`);
  return res;
};

const protectedPathsForAllModes = [
  "/",
  "/en",
  "/en/settings",
  "/ar/shopify",
  "/en/a.b",
  "/en.rsc",
  "/api/integrations/shopify/callback",
  "/api/unknown",
];

if (FAIL_CLOSED) {
  // Production without valid credentials: nothing behind the gate is served, with or
  // without an Authorization header — but the public files stay reachable.
  for (const path of protectedPathsForAllModes) {
    for (const headers of [{}, auth]) {
      const res = await expectStatus("fail-closed:", path, 503, { headers });
      checks++;
      if (res.headers.get("cache-control") !== "no-store") failures.push(`fail-closed: ${path} must not be cacheable`);
    }
  }
  await expectStatus("fail-closed (server action):", "/en/settings", 503, {
    method: "POST",
    headers: { ...auth, "next-action": "0".repeat(42), "content-type": "text/plain;charset=UTF-8" },
    body: "[]",
  });
  for (const path of ["/en/manifest.webmanifest", "/sw.js", "/offline.html", "/icons/icon-192.png", "/icon.svg"]) {
    await expectStatus("fail-closed public:", path, 200);
  }
  const health = await expectStatus("fail-closed health:", "/api/health", 503);
  checks++;
  if ((await health.json().catch(() => ({}))).access !== "not_configured") failures.push("health should report access: not_configured");
  report();
}

// 1. Protected without credentials — including dotted paths, RSC suffixes and actions.
const protectedPaths = [
  "/",
  "/en",
  "/ar",
  "/en/settings",
  "/en/shopify",
  "/ar/approvals",
  "/en/settings.x",
  "/en/a.b",
  "/en/shopify.json",
  "/en.rsc",
  "/en/settings.rsc",
  "/en/x/y.txt",
  "/api/integrations/shopify/callback",
  "/api/integrations/shopify/callback?state=x&shop=a.myshopify.com",
  "/api/unknown",
  "/robots.txt",
];
for (const path of protectedPaths) await expectStatus("no credentials:", path, 401);
for (const path of ["/en/a.b", "/en/settings", "/en/settings.x"]) {
  await expectStatus("no credentials (server action):", path, 401, {
    method: "POST",
    headers: { "next-action": "0".repeat(42), "content-type": "text/plain;charset=UTF-8" },
    body: "[]",
  });
}
await expectStatus("wrong password:", "/en/settings", 401, { headers: wrongAuth });
// Framework-internal headers must not skip the gate (cf. the 2025 middleware-bypass CVE).
for (const header of ["proxy", "middleware", "src/proxy", "proxy:proxy:proxy:proxy:proxy"]) {
  await expectStatus("spoofed x-middleware-subrequest:", "/en/settings", 401, { headers: { "x-middleware-subrequest": header } });
}

// 2. Public, data-free files — reachable without credentials.
const html = await (await fetch(`${BASE}/en/settings`, { headers: auth })).text();
const staticAsset = /\/_next\/static\/[^"'\s)]+\.(?:js|css)/.exec(html)?.[0];
checks++;
if (!staticAsset) failures.push("could not find a /_next/static asset in the page HTML");
const publicPaths = [
  "/api/health",
  "/en/manifest.webmanifest",
  "/ar/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
  "/icons/icon-192.png",
  "/icons/icon-maskable-512.png",
  "/icon.svg",
  "/apple-icon.png",
  ...(staticAsset ? [staticAsset] : []),
];
for (const path of publicPaths) {
  const res = await expectStatus("public:", path, 200);
  if (path === "/api/health") {
    checks++;
    const body = await res.json().catch(() => ({}));
    if (JSON.stringify(body).match(/shopify|integration|connected/i)) failures.push("/api/health reveals integration state");
  }
}

// 3. With credentials: pages work, the root redirects to a locale, the callback is reachable.
await expectStatus("with credentials:", "/en/settings", 200, { headers: auth });
await expectStatus("with credentials:", "/ar/shopify", 200, { headers: auth });
await expectStatus("with credentials:", "/", [307, 308], { headers: auth });
const callback = await expectStatus("with credentials:", "/api/integrations/shopify/callback", 303, { headers: auth });
checks++;
if (!/\/settings\?shopify=SHOPIFY_STATE_INVALID/.test(callback.headers.get("location") ?? "")) {
  failures.push(`callback without state should report SHOPIFY_STATE_INVALID (got ${callback.headers.get("location")})`);
}

// 4. Authenticated users still can't bypass server-side validation with direct requests.
//    A forged OAuth callback (valid password, invalid state/HMAC) is rejected without a token exchange.
const forged = await expectStatus(
  "authenticated forged callback:",
  "/api/integrations/shopify/callback?code=x&shop=evil.myshopify.com&state=forged&timestamp=1&hmac=" + "0".repeat(64),
  303,
  { headers: auth },
);
checks++;
if (!/shopify=SHOPIFY_STATE_INVALID/.test(forged.headers.get("location") ?? "")) {
  failures.push(`forged callback should be rejected as SHOPIFY_STATE_INVALID (got ${forged.headers.get("location")})`);
}
report();

function report() {
  if (failures.length) {
    console.error(`✗ ${failures.length} of ${checks} auth-gate checks failed:\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(`✓ Dashboard access gate (${FAIL_CLOSED ? "fail-closed" : "credentials required"}): ${checks} checks passed.`);
  process.exit(0);
}

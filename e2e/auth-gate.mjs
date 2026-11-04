/**
 * Basic Auth gate check against a running server started WITH
 * DASHBOARD_BASIC_AUTH_USER / DASHBOARD_BASIC_AUTH_PASSWORD.
 *
 *   BASE_URL=http://localhost:3000 BASIC_AUTH=user:password npm run test:auth-gate
 *
 * Without credentials: every page, every dotted variant of a page path (the
 * [lang]/[...rest] catch-all renders the app shell for those), server-action POSTs
 * and API routes other than /api/health must answer 401 — while the data-free
 * public files (PWA manifest, icons, service worker, offline page, Next.js static
 * assets, health probe) must stay reachable, because browsers fetch them without
 * credentials. With credentials, pages and the OAuth callback must work.
 */
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const [user, ...rest] = (process.env.BASIC_AUTH ?? "").split(":");
if (!user || !rest.length) {
  console.error("Set BASIC_AUTH=user:password (the server's DASHBOARD_BASIC_AUTH_* values).");
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

if (failures.length) {
  console.error(`✗ ${failures.length} of ${checks} auth-gate checks failed:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`✓ Basic Auth gate: ${checks} checks passed.`);

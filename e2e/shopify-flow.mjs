/**
 * End-to-end test of the Shopify connect flow against a running production build
 * with a FAKE Shopify (see e2e/fake-shopify-preload.mjs). Nothing reaches Shopify:
 * the browser's trip to the store's /admin/oauth/authorize is intercepted and
 * answered with a correctly signed callback, and the server's token/GraphQL
 * requests are served by the preload.
 *
 *   docs/SHOPIFY.md → "Run the end-to-end connect test" has the full command.
 *
 * Env: BASE_URL (must equal APP_URL), SHOPIFY_STORE_DOMAIN (*-e2e.myshopify.com),
 *      SHOPIFY_CLIENT_SECRET (same fake value as the server), SCREENSHOTS=<dir>,
 *      KEEP_CONNECTED=1 to finish connected (skip the disconnect step),
 *      BASIC_AUTH=user:password when the server has DASHBOARD_BASIC_AUTH_* set.
 */
import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, devices } from "playwright";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SHOP = process.env.SHOPIFY_STORE_DOMAIN ?? "";
const SECRET = process.env.SHOPIFY_CLIENT_SECRET ?? "";
const SHOTS = process.env.SCREENSHOTS;
const [authUser, ...authRest] = (process.env.BASIC_AUTH ?? "").split(":");
const httpCredentials = authUser ? { username: authUser, password: authRest.join(":") } : undefined;
if (!SHOP.endsWith("-e2e.myshopify.com") || !SECRET) {
  console.error("Set SHOPIFY_STORE_DOMAIN=<name>-e2e.myshopify.com and the fake SHOPIFY_CLIENT_SECRET used by the server.");
  process.exit(2);
}

const failures = [];
let checks = 0;
const check = (condition, message) => {
  checks++;
  if (!condition) failures.push(message);
};
/** Waits for streamed (Suspense) content instead of checking instantly. */
const visible = (locator, timeout = 15_000) =>
  locator
    .filter({ visible: true }) // phone-only and desktop-only copies of a list both exist in the DOM
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);

/** Builds the callback Shopify would send, signed with the (fake) client secret. */
function signedCallback(state) {
  const params = {
    code: `e2e_code_${Date.now()}`,
    host: Buffer.from(`admin.shopify.com/store/${SHOP.split(".")[0]}`).toString("base64url"),
    shop: SHOP,
    state,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const message = new URLSearchParams(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1))).toString();
  const hmac = createHmac("sha256", SECRET).update(message).digest("hex");
  return `${BASE}/api/integrations/shopify/callback?${new URLSearchParams({ ...params, hmac })}`;
}

const browser = await chromium.launch();
if (SHOTS) await mkdir(SHOTS, { recursive: true });
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, httpCredentials });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// Any browser request to the store is answered here — the real Shopify is never contacted.
let authorizeUrl = null;
await context.route(`https://${SHOP}/**`, async (route) => {
  const url = new URL(route.request().url());
  authorizeUrl = url;
  await route.fulfill({ status: 302, headers: { location: signedCallback(url.searchParams.get("state") ?? "") } });
});

// 1. Before connecting: demo data, clearly labelled, and a Connect button.
await page.goto(`${BASE}/en/shopify`);
check(await visible(page.getByText("Shopify: demo data")), "demo label shown before connecting");
await page.goto(`${BASE}/en/settings`);
const connect = page.getByRole("button", { name: "Connect Shopify" });
check(await visible(connect), "Connect Shopify button visible");
await shot(page, "1-settings-ready-en");

// 2. A callback without the state cookie is rejected.
const forged = await context.newPage();
await forged.goto(signedCallback("forged-state"));
check(forged.url().includes("shopify=SHOPIFY_STATE_INVALID"), `forged callback rejected (got ${forged.url()})`);
check(await visible(forged.getByText("expired or didn't start from this browser")), "state error explained");
await forged.close();

// 3. Connect: server action → Shopify authorize (intercepted) → callback → Settings.
await connect.click();
await page.waitForURL(/\/en\/settings\?shopify=connected/, { timeout: 30_000 });
check(authorizeUrl?.pathname === "/admin/oauth/authorize", "browser was sent to the store's /admin/oauth/authorize");
check(authorizeUrl?.searchParams.get("scope") === "read_orders,read_products", "only read scopes requested");
check(authorizeUrl?.searchParams.get("redirect_uri") === `${BASE}/api/integrations/shopify/callback`, "redirect_uri built from APP_URL");
check(!authorizeUrl?.toString().includes(SECRET), "client secret never in the browser URL");
check(await visible(page.getByText("Shopify connected. Pages now show live data")), "connected result shown");
check(await visible(page.getByText("Drops Of Growth (E2E fake)")), "shop name shown");
const cookies = await context.cookies();
check(!cookies.some((c) => c.name === "shopify_oauth_state" && c.value), "state cookie cleared after callback");
const html = await page.content();
check(!/shpat_|shprt_/.test(html) && !html.includes(SECRET), "no token or secret in the page HTML");
await shot(page, "2-settings-connected-en");

// 4. Live data replaces demo data.
await page.goto(`${BASE}/en/shopify`);
check(await visible(page.getByText("Shopify: live · Drops Of Growth (E2E fake)")), "live label on Shopify page");
check(await visible(page.getByText("Rose Glow Serum")), "live product listed");
check((await page.content()).includes("AED"), "store currency (AED) used");
check(!(await page.getByText("Demo Store (mock)").count()), "no demo store name");
check(await visible(page.getByText("Shopify is connected read-only")), "global banner reflects the live connection");
await shot(page, "3-shopify-live-en");

await page.goto(`${BASE}/en`);
check(await visible(page.getByText("Meta Ads is still demo data")), "overview explains live/demo mix");
check(await visible(page.getByRole("heading", { name: "Store revenue" })), "revenue charted alone (not vs demo spend)");

// 5. Arabic + phone layout with live data.
const phone = await browser.newContext({ ...devices["iPhone 15"], httpCredentials });
await phone.route(`https://${SHOP}/**`, (route) => route.abort());
const ar = await phone.newPage();
await ar.goto(`${BASE}/ar/shopify`);
check((await ar.getAttribute("html", "dir")) === "rtl", "Arabic page is RTL");
check(await visible(ar.getByText("Shopify: مباشر")), "Arabic live label");
check(await visible(ar.getByText("عطر العود الملكي")), "Arabic product title rendered");
const overflow = await ar.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check(!overflow, "no horizontal scroll on phone (ar)");
await shot(ar, "4-shopify-live-ar-phone");
await ar.goto(`${BASE}/ar/settings#shopify`);
check(await visible(ar.getByText("متصل")), "Arabic connected status");
await shot(ar, "5-settings-connected-ar-phone");
await phone.close();

// 6. Verify (read-only re-check) and disconnect.
await page.goto(`${BASE}/en/settings`);
await page.getByRole("button", { name: "Verify connection" }).click();
check(await visible(page.getByText("read-only access confirmed")), "verify succeeded");
// KEEP_CONNECTED=1 stops here so other suites (e.g. test:responsive) can run against live data.
if (process.env.KEEP_CONNECTED === "1") {
  await browser.close();
  console.log(failures.length ? `✗ ${failures.join(" | ")}` : `✓ connected and verified (${checks} checks); left connected.`);
  process.exit(failures.length ? 1 : 0);
}
await page.getByRole("button", { name: "Disconnect" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
await page.getByText("The stored access token was deleted").first().waitFor({ timeout: 15_000 });
await page.goto(`${BASE}/en/shopify`);
check(await visible(page.getByText("Shopify: demo data")), "back to labelled demo data after disconnect");
check(await visible(page.getByText("Integrations are running on mock data")), "global banner back to demo wording");

check(errors.length === 0, `no page errors (${errors.join(" | ")})`);
await browser.close();

if (failures.length) {
  console.error(`✗ ${failures.length} of ${checks} checks failed:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`✓ Shopify connect flow: ${checks} checks passed.`);

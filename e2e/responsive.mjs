/**
 * Responsive + PWA smoke test against a running server.
 *
 *   npm run build && npm start            # in one terminal
 *   npm run test:responsive               # in another
 *
 * Options (env): BASE_URL (default http://localhost:3000, or a deployed https:// URL),
 *                BASIC_AUTH=user:password when DASHBOARD_BASIC_AUTH_* is enabled,
 *                SCREENSHOTS=<dir> to save a full-page PNG per page/viewport/locale.
 * First run on a new machine: `npx playwright install chromium`.
 *
 * For every page × locale × viewport it checks: HTTP 200, <html lang/dir>, no
 * horizontal page scroll, no console/page errors, and that the right navigation
 * is showing (phone tab bar / tablet rail / desktop sidebar). On a phone it also
 * opens the "More" sheet, a budget-change dialog (then closes it — nothing is
 * submitted) and taps a chart. Finally it checks the PWA manifest, service
 * worker and offline page.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, devices } from "playwright";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SHOTS = process.env.SCREENSHOTS;
const [authUser, ...authRest] = (process.env.BASIC_AUTH ?? "").split(":");
const httpCredentials = authUser ? { username: authUser, password: authRest.join(":") } : undefined;

const PAGES = ["", "/meta-ads", "/shopify", "/creatives", "/analytics", "/automations", "/approvals", "/settings"];
const LOCALES = [
  { lang: "en", dir: "ltr" },
  { lang: "ar", dir: "rtl" },
];

/** nav: which navigation must be visible at this width. */
const VIEWPORTS = [
  { name: "small-phone-320", nav: "tabbar", options: { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true } },
  { name: "iphone-se", nav: "tabbar", options: devices["iPhone SE"] },
  { name: "iphone-15", nav: "tabbar", options: devices["iPhone 15"] },
  { name: "pixel-7", nav: "tabbar", options: devices["Pixel 7"] },
  { name: "galaxy-s9", nav: "tabbar", options: devices["Galaxy S9+"] },
  { name: "ipad-mini-portrait", nav: "rail", options: devices["iPad Mini"] },
  { name: "ipad-pro-landscape", nav: "sidebar", options: devices["iPad Pro 11 landscape"] },
  { name: "laptop-1280", nav: "sidebar", options: { viewport: { width: 1280, height: 800 } } },
  { name: "desktop-1920", nav: "sidebar", options: { viewport: { width: 1920, height: 1080 } } },
];

const failures = [];
let checks = 0;
const fail = (where, message) => failures.push(`${where}: ${message}`);
const check = (condition, where, message) => {
  checks++;
  if (!condition) fail(where, message);
};

// Use Chromium for every profile (device descriptors only provide size, touch and UA).
const browser = await chromium.launch();
if (SHOTS) await mkdir(SHOTS, { recursive: true });

for (const vp of VIEWPORTS) {
  const { defaultBrowserType: _ignored, ...options } = vp.options;
  const context = await browser.newContext({ ...options, deviceScaleFactor: 1, httpCredentials });

  for (const { lang, dir } of LOCALES) {
    for (const route of PAGES) {
      const url = `${BASE}/${lang}${route}`;
      const where = `${vp.name} ${lang}${route || "/"}`;
      const page = await context.newPage();
      const errors = [];
      page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
      page.on("pageerror", (error) => errors.push(String(error)));

      const response = await page.goto(url, { waitUntil: "networkidle" });
      check(response?.status() === 200, where, `HTTP ${response?.status()}`);

      const layout = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // KPI values must fit their tile on one line (they never wrap).
        clippedKpis: [...document.querySelectorAll("[data-kpi-value]")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.textContent),
      }));
      check(layout.lang === lang && layout.dir === dir, where, `html lang/dir = ${layout.lang}/${layout.dir}`);
      check(layout.overflow <= 0, where, `page scrolls sideways by ${layout.overflow}px`);
      check(layout.clippedKpis.length === 0, where, `KPI values overflow their tile: ${layout.clippedKpis.join(", ")}`);

      for (const nav of ["tabbar", "rail", "sidebar"]) {
        const visible = await page.locator(`[data-nav="${nav}"]`).isVisible();
        check(visible === (nav === vp.nav), where, `${nav} ${visible ? "visible" : "hidden"}, expected ${nav === vp.nav ? "visible" : "hidden"}`);
      }

      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${vp.name}-${lang}${route.replace("/", "-") || "-overview"}.png`), fullPage: true });
      check(errors.length === 0, where, `console errors: ${errors.slice(0, 2).join(" | ")}`);
      await page.close();
    }

    // Interaction checks on one phone profile per locale.
    if (vp.name === "iphone-15") {
      const page = await context.newPage();
      const where = `${vp.name} ${lang} interactions`;
      const viewportHeight = vp.options.viewport.height;

      await page.goto(`${BASE}/${lang}`, { waitUntil: "networkidle" });
      await page.locator('[data-nav="tabbar"] button').tap();
      const sheet = page.locator('[data-nav="more-sheet"]');
      await sheet.waitFor({ state: "visible" });
      await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))); // slide-up entrance
      const box = await sheet.boundingBox();
      check(box && Math.abs(box.y + box.height - viewportHeight) <= 1, where, "More sheet is not anchored to the bottom edge");
      check((await sheet.locator("a").count()) >= 8, where, "More sheet does not list every section");
      await sheet.locator(`a[href="/${lang}/settings"]`).tap();
      await page.waitForURL(`**/${lang}/settings`);
      check(!(await sheet.isVisible()), where, "More sheet stays open after navigating");

      await page.goto(`${BASE}/${lang}/meta-ads`, { waitUntil: "networkidle" });
      const trigger = page.locator("main ul li button:visible").first();
      await trigger.tap();
      const dialog = page.locator("dialog[open]");
      await dialog.waitFor({ state: "visible" });
      await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const dialogBox = await dialog.boundingBox();
      check(dialogBox && dialogBox.width >= vp.options.viewport.width - 1, where, "budget dialog is not a full-width sheet");
      const input = dialog.locator('input[name="proposedDailyBudget"]');
      const fontSize = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      check(fontSize >= 16, where, `input font-size ${fontSize}px (< 16px zooms on iOS)`);
      await dialog.locator("button[aria-label]").first().tap(); // close, never submit
      check(!(await dialog.isVisible()), where, "budget dialog did not close");

      const plot = page.locator('[role="img"][tabindex="0"]').first();
      await plot.scrollIntoViewIfNeeded();
      const plotBox = await plot.boundingBox();
      await page.touchscreen.tap(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
      check(await page.locator('figure [role="status"]').first().isVisible(), where, "chart readout did not appear on tap");
      await page.close();
    }
  }
  await context.close();
}

// PWA endpoints.
const api = await browser.newContext({ httpCredentials });
for (const { lang, dir } of LOCALES) {
  const res = await api.request.get(`${BASE}/${lang}/manifest.webmanifest`);
  const where = `manifest ${lang}`;
  check(res.status() === 200, where, `HTTP ${res.status()}`);
  check((res.headers()["content-type"] ?? "").includes("application/manifest+json"), where, "wrong content type");
  const manifest = await res.json();
  check(manifest.start_url === `/${lang}` && manifest.dir === dir && manifest.display === "standalone", where, JSON.stringify(manifest).slice(0, 120));
  for (const icon of manifest.icons) {
    const iconRes = await api.request.get(`${BASE}${icon.src}`);
    check(iconRes.status() === 200, where, `icon ${icon.src} → ${iconRes.status()}`);
  }
}
const sw = await api.request.get(`${BASE}/sw.js`);
check(sw.status() === 200 && sw.headers()["content-type"]?.includes("javascript"), "sw.js", `HTTP ${sw.status()} ${sw.headers()["content-type"]}`);
check((sw.headers()["cache-control"] ?? "").includes("no-cache"), "sw.js", "must not be cached");
check((await api.request.get(`${BASE}/offline.html`)).status() === 200, "offline.html", "missing");
const head = await (await api.request.get(`${BASE}/ar`)).text();
check(head.includes('rel="manifest" href="/ar/manifest.webmanifest"'), "head /ar", "no localized manifest link");
check(/rel="apple-touch-icon"/.test(head), "head /ar", "no apple-touch-icon");
check(/viewport-fit=cover/.test(head), "head /ar", "viewport-fit=cover missing");
await api.close();
await browser.close();

if (failures.length) {
  console.error(`\n✗ ${failures.length} of ${checks} checks failed:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`✓ ${checks} checks passed (${VIEWPORTS.length} viewports × ${LOCALES.length} locales × ${PAGES.length} pages + interactions + PWA).`);

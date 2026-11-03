import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ar } from "@/i18n/dictionaries/ar";
import { en } from "@/i18n/dictionaries/en";
import { buildManifest } from "@/lib/pwa/manifest";

const root = path.resolve(import.meta.dirname, "../../..");
const publicFile = (url: string) => path.join(root, "public", url);

/** Width/height from a PNG's IHDR chunk. */
function pngSize(file: string): string {
  const buffer = readFileSync(file);
  return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}

describe("web app manifest", () => {
  it("is localized and opens in the language it was installed from", () => {
    const enManifest = buildManifest("en");
    const arManifest = buildManifest("ar");

    expect(enManifest).toMatchObject({ lang: "en", dir: "ltr", start_url: "/en", name: en.meta.title });
    expect(arManifest).toMatchObject({ lang: "ar", dir: "rtl", start_url: "/ar", name: ar.meta.title });
    expect(arManifest.shortcuts?.map((s) => s.url)).toEqual(["/ar/approvals", "/ar/meta-ads", "/ar/analytics"]);
  });

  it("shares one app identity and scope across languages", () => {
    for (const manifest of [buildManifest("en"), buildManifest("ar")]) {
      expect(manifest).toMatchObject({ id: "/", scope: "/", display: "standalone" });
      expect(manifest.short_name!.length).toBeLessThanOrEqual(12);
    }
  });

  it("points at icon files that exist with the declared sizes, incl. a maskable one", () => {
    const icons = buildManifest("en").icons ?? [];
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    expect(icons.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(icons.some((icon) => icon.sizes === "512x512")).toBe(true);
    for (const icon of icons) {
      const file = publicFile(icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      expect(pngSize(file)).toBe(icon.sizes);
    }
    expect(pngSize(path.join(root, "src/app/apple-icon.png"))).toBe("180x180");
  });
});

describe("offline page", () => {
  const html = readFileSync(publicFile("offline.html"), "utf8");
  const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

  it("is in sync with the dictionaries (run `npm run pwa:assets` after editing them)", () => {
    for (const dict of [en, ar]) {
      expect(html).toContain(escape(dict.offline.title));
      expect(html).toContain(escape(dict.offline.body));
      expect(html).toContain(escape(dict.offline.retry));
    }
  });

  it("marks the Arabic section as RTL", () => {
    expect(html).toContain('<section lang="ar" dir="rtl">');
  });
});

describe("service worker", () => {
  const sw = readFileSync(publicFile("sw.js"), "utf8");

  it("precaches the offline page and only handles GET navigations", () => {
    expect(sw).toContain('const OFFLINE_URL = "/offline.html"');
    expect(sw).toMatch(/request\.method !== "GET" \|\| request\.mode !== "navigate"\) return;/);
  });

  it("never caches dashboard responses (no cache.put)", () => {
    expect(sw).not.toMatch(/\.put\(/);
  });
});

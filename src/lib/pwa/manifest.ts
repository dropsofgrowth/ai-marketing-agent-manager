import type { MetadataRoute } from "next";

import { directionOf, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

/** Splash/background colour — the light page colour (manifests can't vary by colour scheme). */
export const PWA_BACKGROUND = "#f5f5f2";
export const PWA_THEME = "#fcfcfb";

export const PWA_ICONS: MetadataRoute.Manifest["icons"] = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

/**
 * Web app manifest for one locale. Installing from an Arabic page gives an
 * Arabic, RTL app that opens on /ar; both locales share one app identity and
 * scope, so switching language inside the installed app keeps it in-app.
 */
export function buildManifest(locale: Locale): MetadataRoute.Manifest {
  const dict = getDictionary(locale);
  const base = `/${locale}`;
  const shortcutIcon = [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }];
  return {
    id: "/",
    name: dict.meta.title,
    short_name: dict.meta.shortName,
    description: dict.meta.description,
    lang: locale,
    dir: directionOf(locale),
    start_url: base,
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: PWA_BACKGROUND,
    theme_color: PWA_THEME,
    categories: ["business", "productivity"],
    icons: PWA_ICONS,
    shortcuts: [
      { name: dict.nav.approvals, url: `${base}/approvals`, icons: shortcutIcon },
      { name: dict.nav.metaAds, url: `${base}/meta-ads`, icons: shortcutIcon },
      { name: dict.nav.analytics, url: `${base}/analytics`, icons: shortcutIcon },
    ],
  };
}

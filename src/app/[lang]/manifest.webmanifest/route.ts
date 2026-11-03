import { LOCALES, isLocale } from "@/i18n/config";
import { buildManifest } from "@/lib/pwa/manifest";

/**
 * Localized web app manifest: /en/manifest.webmanifest and /ar/manifest.webmanifest.
 * Prerendered at build time. Paths containing a "." are outside the proxy matcher,
 * so the manifest stays reachable when Basic Auth protects the pages (browsers
 * fetch manifests without credentials).
 */
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function GET(_request: Request, { params }: RouteContext<"/[lang]/manifest.webmanifest">) {
  const { lang } = await params;
  if (!isLocale(lang)) return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(buildManifest(lang)), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

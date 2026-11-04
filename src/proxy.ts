import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "@/i18n/config";
import { describeAuthProblems, verifyBasicAuthHeader } from "@/lib/basic-auth";
import { getDashboardAuth, getEnv } from "@/server/env";
import { log } from "@/server/logging";

/**
 * Runs before every request except a short allow-list of public files (see `config`):
 * 1. Dashboard access (HTTP Basic Auth, DASHBOARD_BASIC_AUTH_USER/PASSWORD), FAIL
 *    CLOSED: missing or invalid credentials refuse every request with 503 however
 *    the server was started (the only exception is the explicit local opt-in
 *    DASHBOARD_AUTH_DISABLED=1 under `next dev`); a missing or wrong Authorization
 *    header gets 401. Server actions
 *    are POSTs to page routes, and API routes (incl. the Shopify OAuth callback)
 *    are covered too. This is the first layer only — `getCurrentActor()` checks the
 *    same credentials again server-side (src/server/auth/dashboard-access.ts).
 * 2. Redirects page paths without a locale prefix to /en or /ar.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

function notConfigured(detail: string) {
  return new NextResponse(`${detail}\nSee .env.example and docs/DEPLOYMENT.md.`, {
    status: 503,
    headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
  });
}

function preferredLocale(request: NextRequest): Locale {
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;

  const accepted = (request.headers.get("accept-language") ?? "")
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { lang: tag.toLowerCase().split("-")[0], q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { lang } of accepted) if (isLocale(lang)) return lang;

  return getEnv().DEFAULT_LOCALE ?? DEFAULT_LOCALE;
}

export async function proxy(request: NextRequest) {
  let auth: ReturnType<typeof getDashboardAuth>;
  try {
    auth = getDashboardAuth();
  } catch (error) {
    // Unparseable environment: refuse rather than guess. getEnv's message lists variable names only.
    log("error", "proxy.env_invalid", { detail: error instanceof Error ? error.message : "unknown" });
    return notConfigured("Server configuration is invalid.");
  }
  if (auth.mode === "misconfigured") return notConfigured(describeAuthProblems(auth.problems));
  if (auth.mode === "required" && !(await verifyBasicAuthHeader(request.headers.get("authorization"), auth))) {
    return new NextResponse("Authentication required.", {
      status: 401,
      headers: { ...NO_STORE, "WWW-Authenticate": 'Basic realm="Marketing Agent", charset="UTF-8"' },
    });
  }

  const { pathname } = request.nextUrl;
  // API routes are authenticated above but never localized.
  if (pathname === "/api" || pathname.startsWith("/api/")) return NextResponse.next();
  const firstSegment = pathname.split("/")[1];
  if (isLocale(firstSegment)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${preferredLocale(request)}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  /*
   * Everything goes through the proxy EXCEPT these public, data-free files: Next.js
   * static assets, the health probe, and the PWA files browsers fetch without
   * credentials (the two localized manifests, the manifest's icons by exact name,
   * service worker, offline page). Keep the exclusions exact: anything else that
   * skips the proxy reaches the [lang]/[...rest] catch-all and then relies on the
   * server-side check alone.
   *
   * Do not go back to excluding "any path with a dot" or a whole directory: the
   * catch-all renders the app shell for paths like /en/x.y, so that pattern let
   * anyone bypass Basic Auth. src/proxy.test.ts and e2e/auth-gate.mjs guard this
   * list (and that every icon the manifest names stays reachable).
   */
  matcher: [
    "/((?!_next/static/|_next/image|api/health$|icons/(?:icon-192|icon-512|icon-maskable-512)\\.png$|sw\\.js$|offline\\.html$|icon\\.svg$|apple-icon\\.png$|(?:en|ar)/manifest\\.webmanifest$).*)",
  ],
};

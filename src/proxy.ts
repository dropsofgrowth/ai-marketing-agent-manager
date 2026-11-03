import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "@/i18n/config";

/**
 * Runs before every page request and server action:
 * 1. Optional HTTP Basic Auth (DASHBOARD_BASIC_AUTH_USER/PASSWORD) — a stop-gap
 *    for preview deployments until real sign-in exists. Server actions are POSTs
 *    to page routes, so they are covered too.
 * 2. Redirects paths without a locale prefix to /en or /ar.
 */

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** Constant-time comparison of two SHA-256 digests. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

async function isAuthorized(request: NextRequest, user: string, password: string): Promise<boolean> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const [userOk, passOk] = await Promise.all([
    safeEqual(decoded.slice(0, separator), user),
    safeEqual(decoded.slice(separator + 1), password),
  ]);
  return userOk && passOk;
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

  const configured = process.env.DEFAULT_LOCALE;
  return isLocale(configured) ? configured : DEFAULT_LOCALE;
}

export async function proxy(request: NextRequest) {
  const user = process.env.DASHBOARD_BASIC_AUTH_USER;
  const password = process.env.DASHBOARD_BASIC_AUTH_PASSWORD;
  if (user && password && !(await isAuthorized(request, user, password))) {
    return new NextResponse("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Marketing Agent", charset="UTF-8"' },
    });
  }

  const { pathname } = request.nextUrl;
  const firstSegment = pathname.split("/")[1];
  if (isLocale(firstSegment)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${preferredLocale(request)}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except API routes, Next.js internals and files with an extension.
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};

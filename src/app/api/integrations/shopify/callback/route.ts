import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { isDomainError } from "@/domain/errors";
import type { ShopifyConnectResult } from "@/domain/shopify-connect";
import type { Actor } from "@/domain/types";
import type { Locale } from "@/i18n/config";
import { getCurrentActor } from "@/server/auth/actor";
import { getEnv } from "@/server/env";
import { SHOPIFY_CALLBACK_PATH, SHOPIFY_STATE_COOKIE, getShopifyConnectionService } from "@/server/integrations/shopify";
import { log } from "@/server/logging";

/**
 * Shopify OAuth redirect target (authorization code grant).
 *
 * Security: dashboard credentials (proxy AND `getCurrentActor()` here), then the
 * state cookie (signed, httpOnly, one-time), the HMAC (client secret), the
 * timestamp, the shop domain (must equal SHOPIFY_STORE_DOMAIN) and the caller's
 * permission are all checked in the connection service before the code is redeemed.
 * The response is a redirect to Settings carrying only a result code — never a token. The redirect target is built from APP_URL, not the Host header.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SHOPIFY_STATE_COOKIE)?.value;

  // Server-side access check (independent of the proxy): no identity, no token exchange.
  let actor: Actor;
  try {
    actor = await getCurrentActor();
  } catch (error) {
    if (isDomainError(error) && error.code === "UNAUTHENTICATED") {
      return new NextResponse("Authentication required.", {
        status: 401,
        headers: { "Cache-Control": "no-store", "WWW-Authenticate": 'Basic realm="Marketing Agent", charset="UTF-8"' },
      });
    }
    return new NextResponse("Dashboard access is not configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  let outcome: { locale: Locale; result: ShopifyConnectResult };
  try {
    outcome = await getShopifyConnectionService().completeConnect(actor, request.nextUrl.searchParams, cookieValue);
  } catch (error) {
    log("error", "shopify.oauth.callback_failed", { detail: error instanceof Error ? error.name : "unknown" });
    outcome = { locale: "en", result: "SHOPIFY_UNAVAILABLE" };
  }

  const target = new URL(`/${outcome.locale}/settings`, getEnv().APP_URL);
  target.searchParams.set("shopify", outcome.result);
  target.hash = "shopify";

  const response = NextResponse.redirect(target, 303);
  // The state is single-use: clear it whatever the outcome.
  response.cookies.set(SHOPIFY_STATE_COOKIE, "", { path: SHOPIFY_CALLBACK_PATH, maxAge: 0, httpOnly: true, sameSite: "lax" });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

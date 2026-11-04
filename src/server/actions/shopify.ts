"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { DomainError, isDomainError } from "@/domain/errors";
import { LOCALES } from "@/i18n/config";
import { getCurrentActor } from "@/server/auth/actor";
import { getEnv } from "@/server/env";
import { SHOPIFY_CALLBACK_PATH, SHOPIFY_STATE_COOKIE, getShopifyConnectionService } from "@/server/integrations/shopify";
import { log } from "@/server/logging";

import type { ActionResult } from "./result";
import { formDataToObject, runAction } from "./run-action";

const localeInput = z.object({ locale: z.enum(LOCALES) });

/**
 * Starts the Shopify authorization code grant: sets a signed, httpOnly state cookie
 * (scoped to the callback path) and sends the browser to Shopify. No secret or token
 * ever reaches the browser — only the public authorize URL.
 */
export async function startShopifyConnectAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let authorizeUrl: string;
  try {
    const { locale } = localeInput.parse(formDataToObject(formData));
    const actor = await getCurrentActor();
    // The state cookie is set on this host but Shopify returns to APP_URL; they must match.
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (host && host !== new URL(getEnv().APP_URL).host) throw new DomainError("SHOPIFY_APP_URL_MISMATCH");
    const start = getShopifyConnectionService().beginConnect(actor, locale);
    (await cookies()).set(SHOPIFY_STATE_COOKIE, start.cookieValue, {
      httpOnly: true,
      secure: start.secureCookie,
      // Lax (not Strict): the callback is a top-level navigation coming back from Shopify.
      sameSite: "lax",
      path: SHOPIFY_CALLBACK_PATH,
      maxAge: start.maxAgeSeconds,
    });
    authorizeUrl = start.authorizeUrl;
  } catch (error) {
    if (isDomainError(error)) return { status: "error", code: error.code, params: error.params };
    if (error instanceof z.ZodError) return { status: "error", code: "INVALID_INPUT" };
    log("error", "shopify.connect.start_failed", { detail: error instanceof Error ? error.name : "unknown" });
    return { status: "error", code: "UNEXPECTED" };
  }
  // redirect() throws by design, so it must stay outside the try/catch.
  redirect(authorizeUrl);
}

/** Re-checks the stored token with a read-only query. */
export async function verifyShopifyConnectionAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  return runAction(async (actor) => {
    await getShopifyConnectionService().verify(actor);
    return { code: "SHOPIFY_VERIFIED" };
  });
}

/** Deletes the stored token. Does not uninstall the app in Shopify. */
export async function disconnectShopifyAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  return runAction(async (actor) => {
    await getShopifyConnectionService().disconnect(actor);
    return { code: "SHOPIFY_DISCONNECTED" };
  });
}

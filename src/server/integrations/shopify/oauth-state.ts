import "server-only";

import { randomBytes } from "node:crypto";

import { isLocale, type Locale } from "@/i18n/config";
import { safeEqualStrings } from "@/integrations/shopify/oauth";
import { signWithKey } from "@/server/security/encryption";

/**
 * The OAuth `state` nonce travels to Shopify in the authorize URL and comes back on
 * the callback. A copy is kept in a signed, httpOnly cookie scoped to the callback
 * path so the callback can prove the same browser started the flow (CSRF / login
 * fixation protection). The cookie holds no credentials.
 */
export const SHOPIFY_STATE_COOKIE = "shopify_oauth_state";
export const STATE_MAX_AGE_SECONDS = 600;

const PURPOSE = "shopify-oauth-state";

type StatePayload = { s: string; l: Locale; t: number };

export function createOAuthState(encryptionKey: string, locale: Locale, now: Date) {
  const state = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ s: state, l: locale, t: now.getTime() } satisfies StatePayload)).toString(
    "base64url",
  );
  return { state, cookieValue: `${payload}.${signWithKey(encryptionKey, PURPOSE, payload)}` };
}

/** Returns the stored state and locale, or null if the cookie is missing, forged or older than 10 minutes. */
export function readOAuthState(
  cookieValue: string | undefined,
  encryptionKey: string,
  now: Date,
): { state: string; locale: Locale } | null {
  if (!cookieValue) return null;
  const [payload, signature, extra] = cookieValue.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if (!safeEqualStrings(signature, signWithKey(encryptionKey, PURPOSE, payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<StatePayload>;
    if (typeof parsed.s !== "string" || typeof parsed.t !== "number" || !isLocale(parsed.l)) return null;
    const age = now.getTime() - parsed.t;
    if (age < 0 || age > STATE_MAX_AGE_SECONDS * 1000) return null;
    return { state: parsed.s, locale: parsed.l };
  } catch {
    return null;
  }
}

/** Best-effort locale from an unverified cookie, used only to pick the language of an error page. */
export function peekStateLocale(cookieValue: string | undefined): Locale | null {
  try {
    const parsed = JSON.parse(Buffer.from(cookieValue?.split(".")[0] ?? "", "base64url").toString("utf8")) as {
      l?: unknown;
    };
    return isLocale(parsed.l) ? parsed.l : null;
  } catch {
    return null;
  }
}

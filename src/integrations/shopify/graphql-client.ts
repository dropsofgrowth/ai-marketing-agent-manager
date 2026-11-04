import { z } from "zod";

import type { FetchLike } from "@/integrations/shopify/oauth";
import type { Logger } from "@/server/logging";

/**
 * Read-only Shopify GraphQL Admin API client.
 *
 * - Only `query` operations can be sent: anything containing `mutation` or
 *   `subscription` is refused before a request is made.
 * - Retries throttling (HTTP 429 / GraphQL THROTTLED, waiting for the leaky bucket
 *   to refill) and transient 5xx/network errors with backoff.
 * - On HTTP 401 it asks the token provider for a forced refresh once, then gives up.
 * - Partial data with GraphQL errors is treated as a failure (fail closed).
 * - Logs operation name, status, cost and Shopify's request id — never the token,
 *   variables or response data.
 */

export type ShopifyApiErrorCode =
  /** 401 after a refresh attempt: token revoked or app uninstalled. */
  | "UNAUTHORIZED"
  /** 403 or GraphQL ACCESS_DENIED: a scope or protected-data approval is missing. */
  | "ACCESS_DENIED"
  | "THROTTLED"
  /** 402/423: shop frozen, paused or locked. */
  | "SHOP_UNAVAILABLE"
  /** 404: unknown shop or unsupported API version path. */
  | "NOT_FOUND"
  | "UNAVAILABLE"
  /** GraphQL validation/cost errors — usually a field that doesn't exist in the pinned version. */
  | "QUERY_ERROR"
  | "BAD_RESPONSE";

export class ShopifyApiError extends Error {
  constructor(
    readonly code: ShopifyApiErrorCode,
    readonly httpStatus: number | null = null,
  ) {
    super(`Shopify Admin API request failed: ${code}${httpStatus ? ` (HTTP ${httpStatus})` : ""}`);
    this.name = "ShopifyApiError";
  }
}

export function isShopifyApiError(error: unknown): error is ShopifyApiError {
  return error instanceof ShopifyApiError;
}

/** Supplies the access token; `forceRefresh` is set once after a 401. */
export type TokenProvider = (options: { forceRefresh: boolean }) => Promise<string>;

export function assertReadOnlyDocument(document: string): void {
  const code = document.replace(/#[^\n]*/g, "").trim();
  if (!/^(query\b|\{)/.test(code) || /\b(mutation|subscription)\b/.test(code)) {
    throw new Error("Only read-only GraphQL queries may be sent to Shopify.");
  }
}

const graphqlResponseSchema = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string().optional(),
        path: z.array(z.union([z.string(), z.number()])).optional(),
        extensions: z.object({ code: z.string().optional() }).loose().optional(),
      }),
    )
    .optional(),
  extensions: z
    .object({
      cost: z
        .object({
          requestedQueryCost: z.number().optional(),
          actualQueryCost: z.number().nullable().optional(),
          throttleStatus: z
            .object({
              maximumAvailable: z.number(),
              currentlyAvailable: z.number(),
              restoreRate: z.number(),
            })
            .optional(),
        })
        .optional(),
    })
    .loose()
    .optional(),
});

export type ShopifyGraphqlClient = {
  query<T>(operationName: string, document: string, variables?: Record<string, unknown>): Promise<T>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createShopifyGraphqlClient(options: {
  shop: string;
  apiVersion: string;
  getAccessToken: TokenProvider;
  fetchImpl: FetchLike;
  logger: Logger;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  onSuccess?: () => void;
}): ShopifyGraphqlClient {
  const { shop, apiVersion, getAccessToken, fetchImpl, logger } = options;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? 4;
  const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  const backoff = (attempt: number) => Math.min(8_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
  let versionWarningLogged = false;

  return {
    async query<T>(operationName: string, document: string, variables?: Record<string, unknown>): Promise<T> {
      assertReadOnlyDocument(document);
      let forceRefresh = false;
      let refreshedAfter401 = false;

      for (let attempt = 1; ; attempt++) {
        const canRetry = attempt < maxAttempts;
        const token = await getAccessToken({ forceRefresh });
        forceRefresh = false;
        const started = Date.now();

        let response: Response;
        try {
          response = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "X-Shopify-Access-Token": token,
            },
            body: JSON.stringify({ query: document, variables: variables ?? {} }),
            redirect: "manual",
            signal: AbortSignal.timeout(20_000),
          });
        } catch {
          if (canRetry) {
            await sleep(backoff(attempt));
            continue;
          }
          logger("warn", "shopify.graphql.failed", { operation: operationName, reason: "network", attempt });
          throw new ShopifyApiError("UNAVAILABLE");
        }

        const status = response.status;
        const requestId = response.headers.get("x-request-id") ?? undefined;
        const servedVersion = response.headers.get("x-shopify-api-version");
        if (servedVersion && servedVersion !== apiVersion && !versionWarningLogged) {
          versionWarningLogged = true;
          logger("warn", "shopify.graphql.version_mismatch", { requested: apiVersion, served: servedVersion });
        }
        const fail = (code: ShopifyApiErrorCode, extra: Record<string, string | number> = {}) => {
          logger("warn", "shopify.graphql.failed", { operation: operationName, httpStatus: status, reason: code, requestId, attempt, ...extra });
          return new ShopifyApiError(code, status);
        };

        if (status === 401) {
          if (!refreshedAfter401) {
            refreshedAfter401 = true;
            forceRefresh = true;
            continue;
          }
          throw fail("UNAUTHORIZED");
        }
        if (status === 402 || status === 423) throw fail("SHOP_UNAVAILABLE");
        if (status === 403) throw fail("ACCESS_DENIED");
        if (status === 404) throw fail("NOT_FOUND");
        if (status === 429 || status >= 500) {
          if (canRetry) {
            const retryAfter = Number(response.headers.get("retry-after"));
            await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : backoff(attempt));
            continue;
          }
          throw fail(status === 429 ? "THROTTLED" : "UNAVAILABLE");
        }
        if (status >= 300 && status < 400) throw fail("UNAVAILABLE");
        if (status >= 400) throw fail("QUERY_ERROR");

        let body: z.infer<typeof graphqlResponseSchema>;
        try {
          body = graphqlResponseSchema.parse(await response.json());
        } catch {
          throw fail("BAD_RESPONSE");
        }

        const cost = body.extensions?.cost;
        if (body.errors?.length) {
          const codes = body.errors.map((e) => e.extensions?.code ?? "UNKNOWN");
          const paths = body.errors.map((e) => (e.path ?? []).join(".")).filter(Boolean);
          if (codes.includes("THROTTLED")) {
            const throttle = cost?.throttleStatus;
            const needed = (cost?.requestedQueryCost ?? 100) - (throttle?.currentlyAvailable ?? 0);
            const waitMs = throttle?.restoreRate ? Math.ceil(Math.max(needed, 1) / throttle.restoreRate) * 1000 : backoff(attempt);
            if (canRetry) {
              await sleep(Math.min(Math.max(waitMs, 500), 10_000));
              continue;
            }
            throw fail("THROTTLED");
          }
          const extra = { graphqlCode: codes.join(","), paths: paths.join(",") };
          throw fail(codes.includes("ACCESS_DENIED") ? "ACCESS_DENIED" : "QUERY_ERROR", extra);
        }
        if (body.data === undefined || body.data === null) throw fail("BAD_RESPONSE");

        const ms = Date.now() - started;
        if (ms > 2_000 || (cost?.requestedQueryCost ?? 0) > 500) {
          logger("info", "shopify.graphql.ok", {
            operation: operationName,
            ms,
            requestedCost: cost?.requestedQueryCost,
            actualCost: cost?.actualQueryCost ?? undefined,
            available: cost?.throttleStatus?.currentlyAvailable,
            requestId,
          });
        }
        options.onSuccess?.();
        return body.data as T;
      }
    },
  };
}

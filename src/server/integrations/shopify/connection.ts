import "server-only";

import { randomUUID } from "node:crypto";

import { ZodError } from "zod";

import { DOMAIN_ERROR_CODES, DomainError, isDomainError, type DomainErrorCode } from "@/domain/errors";
import { assertPermission } from "@/domain/permissions";
import type { ShopifyConnectResult } from "@/domain/shopify-connect";
import type { Actor, IntegrationConnection } from "@/domain/types";
import type { Locale } from "@/i18n/config";
import {
  createShopifyGraphqlClient,
  isShopifyApiError,
  type ShopifyGraphqlClient,
} from "@/integrations/shopify/graphql-client";
import { LiveShopifyService, runVerificationQuery } from "@/integrations/shopify/live";
import { MockShopifyService } from "@/integrations/shopify/mock";
import {
  ShopifyOAuthError,
  assessScopes,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  isFreshTimestamp,
  normalizeShopDomain,
  refreshAccessToken,
  safeEqualStrings,
  verifyCallbackHmac,
  type FetchLike,
  type ShopifyTokenSet,
} from "@/integrations/shopify/oauth";
import type { ShopifyService } from "@/integrations/shopify/types";
import type { TtlCache } from "@/lib/ttl-cache";
import type { Logger } from "@/server/logging";
import type { ConnectionPatch, DataStore } from "@/server/store/types";

import type { ShopifyAppConfig, ShopifyReadiness } from "./config";
import {
  CREDENTIALS_KEY_VERSION,
  credentialsContext,
  decryptCredentials,
  encryptCredentials,
  type ShopifyCredentials,
} from "./credentials";
import { STATE_MAX_AGE_SECONDS, createOAuthState, peekStateLocale, readOAuthState } from "./oauth-state";

/** Refresh this long before the access token expires. */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** Write lastSyncedAt at most this often per connection (avoids a DB write per API call). */
const SYNC_WRITE_INTERVAL_MS = 10 * 60_000;

/**
 * Token refresh budget and lease. One server refreshes at a time, holding a lease
 * (not a transaction) for REFRESH_LEASE_MS. The refresh's worst case (attempts ×
 * timeout + backoff = 3 × 10 s + 1 s + 2 s = 33 s) must end well before the lease
 * does — otherwise another server could take over after Shopify has already rotated
 * the refresh token. A test enforces the margin.
 */
export const REFRESH_ATTEMPT_TIMEOUT_MS = 10_000;
export const REFRESH_MAX_ATTEMPTS = 3;
export const REFRESH_BACKOFF_MS = [1_000, 2_000] as const;
export const REFRESH_LEASE_MS = 60_000;
/** Waiting for another server's refresh: short reads every LEASE_POLL_MS, for at most ~15 s. */
export const LEASE_POLL_MS = 500;
export const LEASE_MAX_POLLS = 30;
/** Saving a rotated token: retried briefly on a transient database error. */
const PERSIST_MAX_ATTEMPTS = 3;
const PERSIST_BACKOFF_MS = 250;

/** Stored ciphertext that no longer decrypts — typically CREDENTIALS_ENCRYPTION_KEY changed. */
class CredentialsUnreadableError extends Error {
  constructor() {
    super("Stored Shopify credentials could not be decrypted with the current key.");
    this.name = "CredentialsUnreadableError";
  }
}

// --- View models (safe for the UI: no ciphertext, no tokens) ---------------------

export type ShopifyConnectionView =
  | { state: "not_configured" | "auth_required" | "storage_required" | "app_url_insecure"; missing: string[] }
  | { state: "ready"; shopDomain: string; redirectUri: string }
  | {
      state: "connected";
      shopDomain: string;
      shopName: string | null;
      scopes: string[];
      connectedAt: Date | null;
      lastSyncedAt: Date | null;
      /** Null for a non-expiring token. */
      accessTokenExpiresAt: Date | null;
      refreshTokenExpiresAt: Date | null;
      hasAllOrders: boolean;
      hasInventory: boolean;
      /** Last transient problem (e.g. SHOPIFY_UNAVAILABLE), cleared on the next success. */
      warning: string | null;
      redirectUri: string;
    }
  | { state: "error"; shopDomain: string; shopName: string | null; code: string; lastSyncedAt: Date | null; redirectUri: string };

export type ShopifySource =
  | { mode: "demo"; reason: "not_configured" | "storage_required" | "not_connected"; service: ShopifyService }
  | { mode: "live"; service: ShopifyService; shopDomain: string; shopName: string | null }
  | { mode: "error"; code: DomainErrorCode; shopDomain: string; shopName: string | null };

export type ConnectStart = { authorizeUrl: string; cookieValue: string; secureCookie: boolean; maxAgeSeconds: number };
export type CallbackOutcome = { locale: Locale; result: ShopifyConnectResult };

/** Maps anything thrown while talking to Shopify to a translatable, non-sensitive code. */
export function toShopifyErrorCode(error: unknown): DomainErrorCode {
  if (isDomainError(error) && error.code.startsWith("SHOPIFY_")) return error.code;
  if (isShopifyApiError(error)) {
    if (error.code === "UNAUTHORIZED") return "SHOPIFY_RECONNECT_REQUIRED";
    if (error.code === "ACCESS_DENIED") return "SHOPIFY_MISSING_SCOPES";
  }
  if (error instanceof ZodError) return "SHOPIFY_UNAVAILABLE";
  return "SHOPIFY_UNAVAILABLE";
}

export type ShopifyConnectionDeps = {
  store: DataStore;
  readiness: () => ShopifyReadiness;
  fetchImpl: FetchLike;
  logger: Logger;
  now: () => Date;
  cache: TtlCache;
  sleep?: (ms: number) => Promise<void>;
};

export function createShopifyConnectionService(deps: ShopifyConnectionDeps) {
  const { store, logger, cache } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const demo = new MockShopifyService();
  const lastSyncWrite = new Map<string, number>();

  const cachePrefix = (c: IntegrationConnection) => `shopify:${c.id}:`;
  const contextFor = (c: IntegrationConnection) => credentialsContext(c.workspaceId, c.externalAccountId ?? "");

  function requireReady(): ShopifyAppConfig {
    const readiness = deps.readiness();
    if (readiness.ready) return readiness.config;
    if (readiness.reason === "auth_required") throw new DomainError("DASHBOARD_ACCESS_NOT_CONFIGURED");
    throw new DomainError(readiness.reason === "storage_required" ? "SHOPIFY_STORAGE_REQUIRED" : "SHOPIFY_NOT_CONFIGURED", {
      vars: readiness.missing.join(", "),
    });
  }

  /** The stored connection for the configured store (a connection to a different store is ignored). */
  async function currentFor(workspaceId: string, config: ShopifyAppConfig) {
    const current = await store.connections.getCurrent(workspaceId, "SHOPIFY");
    return current && current.externalAccountId === config.shopDomain ? current : null;
  }

  function decrypt(c: IntegrationConnection, config: ShopifyAppConfig): ShopifyCredentials {
    if (!c.encryptedCredentials) throw new DomainError("SHOPIFY_RECONNECT_REQUIRED");
    try {
      return decryptCredentials(c.encryptedCredentials, config.encryptionKey, contextFor(c));
    } catch {
      throw new CredentialsUnreadableError();
    }
  }

  /** The reason stored on an ERROR connection, if it is a known code. */
  const storedErrorCode = (c: IntegrationConnection): DomainErrorCode =>
    (DOMAIN_ERROR_CODES as readonly string[]).includes(c.lastError ?? "")
      ? (c.lastError as DomainErrorCode)
      : "SHOPIFY_RECONNECT_REQUIRED";

  /** Why a connection that is no longer CONNECTED can't be used. */
  const inactiveCode = (c: IntegrationConnection): DomainErrorCode =>
    c.status === "REVOKED" ? "SHOPIFY_NOT_CONNECTED" : storedErrorCode(c);

  const needsRefresh = (c: IntegrationConnection) =>
    c.accessTokenExpiresAt !== null && c.accessTokenExpiresAt.getTime() - deps.now().getTime() < REFRESH_MARGIN_MS;

  type FlagOptions = { code?: DomainErrorCode; keepCredentials?: boolean; leaseId?: string };

  /**
   * Flags the connection so pages show "reconnect" instead of data. Exactly one caller
   * wins — a conditional update on the CONNECTED status, or on the refresh lease it
   * holds — and only the winner records the audit entry, in one short transaction
   * with no network call inside. Credentials are wiped unless `keepCredentials` (used
   * when they merely can't be decrypted with the current key; reconnecting replaces them).
   */
  async function flagConnection(
    c: IntegrationConnection,
    detail: string,
    options: FlagOptions = {},
  ): Promise<IntegrationConnection | null> {
    const code = options.code ?? "SHOPIFY_RECONNECT_REQUIRED";
    const patch: ConnectionPatch = {
      status: "ERROR",
      lastError: code,
      ...(options.keepCredentials
        ? {}
        : { encryptedCredentials: null, credentialsKeyVersion: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null }),
    };
    const updated = await store.transaction(async (tx) => {
      const row = options.leaseId
        ? await tx.connections.completeRefreshLease(c.workspaceId, c.id, options.leaseId, patch)
        : await tx.connections.updateIfStatus(c.workspaceId, c.id, "CONNECTED", patch);
      if (row) {
        await tx.audit.record({
          workspaceId: c.workspaceId,
          actorId: null,
          actorLabel: "Shopify",
          action: "integration.error",
          entityType: "integration",
          entityId: c.id,
          metadata: { provider: "SHOPIFY", target: c.displayName ?? c.externalAccountId, code },
        });
      }
      return row;
    });
    if (updated) {
      cache.clear(cachePrefix(c));
      logger("warn", "shopify.connection.reconnect_required", { shop: c.externalAccountId, detail, errorCode: code });
    }
    return updated;
  }

  /**
   * Stored credentials that no longer decrypt (typically CREDENTIALS_ENCRYPTION_KEY was
   * changed): flag the connection once and return the row as it now stands.
   */
  async function flagUnreadable(c: IntegrationConnection, leaseId?: string): Promise<IntegrationConnection> {
    const updated = await flagConnection(c, "credentials_unreadable", {
      code: "SHOPIFY_CREDENTIALS_UNREADABLE",
      keepCredentials: true,
      leaseId,
    });
    return (
      updated ??
      (await store.connections.get(c.workspaceId, c.id)) ?? { ...c, status: "ERROR", lastError: "SHOPIFY_CREDENTIALS_UNREADABLE" }
    );
  }

  /** Detects undecryptable credentials before a page tries to use them. */
  async function ensureReadable(c: IntegrationConnection, config: ShopifyAppConfig): Promise<IntegrationConnection> {
    if (c.status !== "CONNECTED" || !c.encryptedCredentials) return c;
    try {
      decrypt(c, config);
      return c;
    } catch (error) {
      if (error instanceof CredentialsUnreadableError) return flagUnreadable(c);
      throw error;
    }
  }

  async function refreshWithRetry(config: ShopifyAppConfig, shop: string, refreshToken: string): Promise<ShopifyTokenSet> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await refreshAccessToken({
          shop,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          refreshToken,
          fetchImpl: deps.fetchImpl,
          now: deps.now(),
          timeoutMs: REFRESH_ATTEMPT_TIMEOUT_MS,
        });
      } catch (error) {
        // A rejection is final; network errors and 5xx are retried within the budget.
        const transient = error instanceof ShopifyOAuthError && error.reason !== "rejected";
        if (!transient || attempt >= REFRESH_MAX_ATTEMPTS) throw error;
        await sleep(REFRESH_BACKOFF_MS[attempt - 1] ?? REFRESH_BACKOFF_MS.at(-1)!);
      }
    }
  }

  type TokenResult = { token: string; latest: IntegrationConnection };

  /** Refreshes in flight in this server process: concurrent requests share one. */
  const inflight = new Map<string, Promise<TokenResult>>();

  /** The access token stored on `row`, flagging the connection if it can't be decrypted. */
  async function tokenOf(row: IntegrationConnection, config: ShopifyAppConfig, leaseId?: string): Promise<string> {
    try {
      return decrypt(row, config).accessToken;
    } catch (error) {
      if (!(error instanceof CredentialsUnreadableError)) throw error;
      await flagUnreadable(row, leaseId);
      throw new DomainError("SHOPIFY_CREDENTIALS_UNREADABLE");
    }
  }

  /**
   * Returns a usable access token, refreshing it when it is about to expire (or when
   * Shopify just answered 401). Within a process, concurrent callers share one
   * refresh; across servers, the refresh lease decides who refreshes and everyone
   * else waits for the rotated token. No database transaction or row lock is ever
   * held while Shopify is called.
   */
  async function accessToken(c: IntegrationConnection, config: ShopifyAppConfig, force: boolean): Promise<TokenResult> {
    if (!force && !needsRefresh(c)) return { token: await tokenOf(c, config), latest: c };
    const running = inflight.get(c.id);
    if (running) return running;
    const task = refreshOrWait(c, config, force).finally(() => inflight.delete(c.id));
    inflight.set(c.id, task);
    return task;
  }

  async function refreshOrWait(c: IntegrationConnection, config: ShopifyAppConfig, force: boolean): Promise<TokenResult> {
    for (let poll = 0; ; poll++) {
      const current = await store.connections.get(c.workspaceId, c.id);
      if (!current || current.externalAccountId !== c.externalAccountId) throw new DomainError("SHOPIFY_NOT_CONNECTED");
      if (current.status !== "CONNECTED") throw new DomainError(inactiveCode(current));
      // Another request or server may already have rotated the token.
      const rotated = current.encryptedCredentials !== c.encryptedCredentials;
      if ((rotated || !force) && !needsRefresh(current)) return { token: await tokenOf(current, config), latest: current };

      const leaseId = randomUUID();
      const now = deps.now();
      const until = new Date(now.getTime() + REFRESH_LEASE_MS);
      if (await store.connections.acquireRefreshLease(c.workspaceId, c.id, leaseId, now, until)) {
        return refreshWithLease(c, config, force, leaseId);
      }
      // Another server is refreshing: wait with short reads (nothing held in between).
      if (poll >= LEASE_MAX_POLLS) {
        logger("warn", "shopify.token.refresh_wait_timeout", { shop: c.externalAccountId });
        throw new DomainError("SHOPIFY_UNAVAILABLE");
      }
      await sleep(LEASE_POLL_MS);
    }
  }

  async function refreshWithLease(
    c: IntegrationConnection,
    config: ShopifyAppConfig,
    force: boolean,
    leaseId: string,
  ): Promise<TokenResult> {
    const release = (patch: ConnectionPatch = {}) =>
      store.connections.completeRefreshLease(c.workspaceId, c.id, leaseId, patch);

    // Re-read under the lease: a refresh may have finished just before we claimed it.
    const current = await store.connections.get(c.workspaceId, c.id);
    if (!current || current.status !== "CONNECTED") {
      await release();
      throw new DomainError(current ? inactiveCode(current) : "SHOPIFY_NOT_CONNECTED");
    }
    const rotated = current.encryptedCredentials !== c.encryptedCredentials;
    if ((rotated || !force) && !needsRefresh(current)) {
      const latest = (await release()) ?? current;
      return { token: await tokenOf(latest, config), latest };
    }

    let creds: ShopifyCredentials;
    try {
      creds = decrypt(current, config);
    } catch (error) {
      if (!(error instanceof CredentialsUnreadableError)) {
        await release();
        throw error;
      }
      await flagUnreadable(current, leaseId);
      throw new DomainError("SHOPIFY_CREDENTIALS_UNREADABLE");
    }
    if (!creds.refreshToken) {
      if (!force) {
        const latest = (await release()) ?? current;
        return { token: creds.accessToken, latest };
      }
      // Non-expiring token that Shopify rejected: access was revoked.
      await flagConnection(current, "token_rejected", { leaseId });
      throw new DomainError("SHOPIFY_RECONNECT_REQUIRED");
    }
    if (current.refreshTokenExpiresAt && current.refreshTokenExpiresAt.getTime() <= deps.now().getTime()) {
      await flagConnection(current, "refresh_token_expired", { leaseId });
      throw new DomainError("SHOPIFY_RECONNECT_REQUIRED");
    }

    let tokens: ShopifyTokenSet;
    try {
      tokens = await refreshWithRetry(config, current.externalAccountId!, creds.refreshToken);
    } catch (error) {
      if (error instanceof ShopifyOAuthError && error.reason === "rejected") {
        await flagConnection(current, `refresh_rejected_${error.httpStatus ?? 0}`, { leaseId });
        throw new DomainError("SHOPIFY_RECONNECT_REQUIRED");
      }
      await release({ lastError: "SHOPIFY_UNAVAILABLE" });
      logger("warn", "shopify.token.refresh_failed", {
        shop: current.externalAccountId,
        detail: error instanceof ShopifyOAuthError ? error.reason : "unknown",
        httpStatus: error instanceof ShopifyOAuthError ? error.httpStatus : null,
      });
      throw new DomainError("SHOPIFY_UNAVAILABLE");
    }

    // The read-only guarantee also holds after a refresh: a token that can write is never stored.
    const scopes = tokens.scopes.length ? tokens.scopes : current.scopes;
    const granted = assessScopes(scopes);
    if (granted.write.length) {
      await flagConnection(current, "refresh_write_scopes", { leaseId, code: "SHOPIFY_WRITE_SCOPES_GRANTED" });
      throw new DomainError("SHOPIFY_WRITE_SCOPES_GRANTED");
    }

    // Persist the rotated refresh token (compare-and-swap on our lease) before using the
    // new access token. Shopify has already invalidated the old one, so a transient
    // database error is retried rather than losing the rotation.
    const patch: ConnectionPatch = {
      encryptedCredentials: encryptCredentials(
        { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? creds.refreshToken },
        config.encryptionKey,
        contextFor(current),
      ),
      credentialsKeyVersion: CREDENTIALS_KEY_VERSION,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? current.refreshTokenExpiresAt,
      scopes,
      lastError: granted.missing.length ? "SHOPIFY_MISSING_SCOPES" : null,
      lastSyncedAt: deps.now(),
    };
    let latest: IntegrationConnection | null = null;
    for (let attempt = 1; ; attempt++) {
      try {
        latest = await release(patch);
        break;
      } catch (error) {
        if (attempt >= PERSIST_MAX_ATTEMPTS) {
          logger("error", "shopify.token.persist_failed", { shop: current.externalAccountId });
          throw error;
        }
        await sleep(PERSIST_BACKOFF_MS * attempt);
      }
    }
    if (!latest) {
      const now = await store.connections.get(c.workspaceId, c.id);
      if (!now || now.status !== "CONNECTED") {
        // Disconnected or flagged while we refreshed: the new token is deliberately not stored.
        throw new DomainError(now ? inactiveCode(now) : "SHOPIFY_NOT_CONNECTED");
      }
      // Only if this refresh outlived REFRESH_LEASE_MS — the budget test keeps that impossible.
      logger("error", "shopify.token.lease_lost", { shop: current.externalAccountId });
      throw new DomainError("SHOPIFY_UNAVAILABLE");
    }
    logger("info", "shopify.token.refreshed", {
      shop: current.externalAccountId,
      accessExpiresAt: tokens.accessTokenExpiresAt?.toISOString() ?? null,
      refreshExpiresAt: latest.refreshTokenExpiresAt?.toISOString() ?? null,
    });
    return { token: tokens.accessToken, latest };
  }

  /** Records a successful call (throttled) and clears a stale transient warning. */
  function noteSuccess(c: IntegrationConnection) {
    const last = lastSyncWrite.get(c.id) ?? 0;
    const nowMs = deps.now().getTime();
    if (!c.lastError && nowMs - last < SYNC_WRITE_INTERVAL_MS) return;
    lastSyncWrite.set(c.id, nowMs);
    c.lastError = null;
    store.connections
      .updateIfStatus(c.workspaceId, c.id, "CONNECTED", { lastSyncedAt: new Date(nowMs), lastError: null })
      .catch(() => logger("warn", "shopify.connection.sync_write_failed", { shop: c.externalAccountId }));
  }

  /** Authenticated GraphQL client for a stored connection, with token refresh and failure bookkeeping. */
  function clientFor(connection: IntegrationConnection, config: ShopifyAppConfig): ShopifyGraphqlClient {
    let snapshot = connection;
    const inner = createShopifyGraphqlClient({
      shop: connection.externalAccountId!,
      apiVersion: config.apiVersion,
      fetchImpl: deps.fetchImpl,
      logger,
      sleep,
      getAccessToken: async ({ forceRefresh }) => {
        const { token, latest } = await accessToken(snapshot, config, forceRefresh);
        snapshot = latest;
        return token;
      },
      onSuccess: () => noteSuccess(snapshot),
    });
    return {
      async query(operationName, document, variables) {
        try {
          return await inner.query(operationName, document, variables);
        } catch (error) {
          if (isShopifyApiError(error) && error.code === "UNAUTHORIZED") {
            // 401 even after a refresh: the app lost access (e.g. uninstalled).
            await flagConnection(snapshot, "api_unauthorized").catch(() => undefined);
          } else if (isShopifyApiError(error) || error instanceof ZodError) {
            const code = toShopifyErrorCode(error);
            await store.connections
              .updateIfStatus(snapshot.workspaceId, snapshot.id, "CONNECTED", { lastError: code })
              .catch(() => undefined);
            if (error instanceof ZodError) {
              logger("warn", "shopify.graphql.unexpected_shape", { operation: operationName, issues: error.issues.length });
            }
          }
          throw error;
        }
      },
    };
  }

  function viewOf(c: IntegrationConnection, config: ShopifyAppConfig): ShopifyConnectionView {
    if (c.status === "ERROR") {
      return {
        state: "error",
        shopDomain: c.externalAccountId ?? config.shopDomain,
        shopName: c.displayName,
        code: c.lastError ?? "SHOPIFY_RECONNECT_REQUIRED",
        lastSyncedAt: c.lastSyncedAt,
        redirectUri: config.redirectUri,
      };
    }
    const scopes = assessScopes(c.scopes);
    return {
      state: "connected",
      shopDomain: c.externalAccountId ?? config.shopDomain,
      shopName: c.displayName,
      scopes: [...c.scopes],
      connectedAt: c.connectedAt,
      lastSyncedAt: c.lastSyncedAt,
      accessTokenExpiresAt: c.accessTokenExpiresAt,
      refreshTokenExpiresAt: c.refreshTokenExpiresAt,
      hasAllOrders: scopes.hasAllOrders,
      hasInventory: scopes.hasInventory,
      warning: c.lastError,
      redirectUri: config.redirectUri,
    };
  }

  return {
    async status(workspaceId: string): Promise<ShopifyConnectionView> {
      const readiness = deps.readiness();
      if (!readiness.ready) return { state: readiness.reason, missing: readiness.missing };
      const stored = await currentFor(workspaceId, readiness.config);
      if (!stored) {
        return { state: "ready", shopDomain: readiness.config.shopDomain, redirectUri: readiness.config.redirectUri };
      }
      return viewOf(await ensureReadable(stored, readiness.config), readiness.config);
    },

    /** Step 1: build the Shopify authorize URL and the signed state cookie. Changes nothing. */
    beginConnect(actor: Actor, locale: Locale): ConnectStart {
      assertPermission(actor, "integration.manage");
      const config = requireReady();
      const { state, cookieValue } = createOAuthState(config.encryptionKey, locale, deps.now());
      logger("info", "shopify.oauth.started", { shop: config.shopDomain, workspace: actor.workspaceId });
      return {
        authorizeUrl: buildAuthorizeUrl({
          shop: config.shopDomain,
          clientId: config.clientId,
          scopes: config.scopes,
          redirectUri: config.redirectUri,
          state,
        }),
        cookieValue,
        secureCookie: config.secureCookies,
        maxAgeSeconds: STATE_MAX_AGE_SECONDS,
      };
    },

    /**
     * Step 2: validate Shopify's redirect and store the token. Every check must pass
     * before the code is redeemed; the token is verified against the configured store
     * and must be read-only before it is encrypted and saved.
     */
    async completeConnect(actor: Actor, params: URLSearchParams, cookieValue: string | undefined): Promise<CallbackOutcome> {
      let locale: Locale = peekStateLocale(cookieValue) ?? "en";
      const fail = (result: ShopifyConnectResult, fields: Record<string, string | number | null> = {}): CallbackOutcome => {
        logger("warn", "shopify.oauth.callback_rejected", { errorCode: result, ...fields });
        return { locale, result };
      };

      const readiness = deps.readiness();
      if (!readiness.ready) {
        return fail(readiness.reason === "storage_required" ? "SHOPIFY_STORAGE_REQUIRED" : "SHOPIFY_NOT_CONFIGURED");
      }
      const config = readiness.config;
      try {
        assertPermission(actor, "integration.manage");
      } catch {
        return fail("FORBIDDEN");
      }

      const now = deps.now();
      const stored = readOAuthState(cookieValue, config.encryptionKey, now);
      if (!stored) return fail("SHOPIFY_STATE_INVALID", { detail: "missing_or_expired_cookie" });
      locale = stored.locale;

      if (params.has("error")) return fail("SHOPIFY_CONNECT_CANCELLED");
      if (!verifyCallbackHmac(params, config.clientSecret)) return fail("SHOPIFY_SIGNATURE_INVALID");
      if (!isFreshTimestamp(params, now)) return fail("SHOPIFY_SIGNATURE_INVALID", { detail: "stale_timestamp" });
      if (!safeEqualStrings(params.get("state") ?? "", stored.state)) {
        return fail("SHOPIFY_STATE_INVALID", { detail: "state_mismatch" });
      }
      const shop = normalizeShopDomain(params.get("shop"));
      if (shop !== config.shopDomain) return fail("SHOPIFY_WRONG_STORE");
      const code = params.get("code");
      if (!code || code.length > 512) return fail("SHOPIFY_SIGNATURE_INVALID", { detail: "missing_code" });

      let tokens: ShopifyTokenSet;
      try {
        tokens = await exchangeAuthorizationCode({
          shop,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          code,
          fetchImpl: deps.fetchImpl,
          now,
        });
      } catch (error) {
        return fail("SHOPIFY_TOKEN_EXCHANGE_FAILED", {
          detail: error instanceof ShopifyOAuthError ? error.reason : "unknown",
          httpStatus: error instanceof ShopifyOAuthError ? error.httpStatus : null,
        });
      }

      // Read-only guarantee: a token that can write is discarded, never stored.
      const granted = assessScopes(tokens.scopes);
      if (granted.write.length) return fail("SHOPIFY_WRITE_SCOPES_GRANTED", { scopes: granted.write.join(",") });
      if (granted.missing.length) return fail("SHOPIFY_MISSING_SCOPES", { missing: granted.missing.join(",") });

      // Prove the token works and belongs to the configured store before saving it.
      let verified: Awaited<ReturnType<typeof runVerificationQuery>>;
      try {
        const probe = createShopifyGraphqlClient({
          shop,
          apiVersion: config.apiVersion,
          fetchImpl: deps.fetchImpl,
          logger,
          sleep,
          getAccessToken: async () => tokens.accessToken,
        });
        verified = await runVerificationQuery(probe);
      } catch {
        return fail("SHOPIFY_UNAVAILABLE", { detail: "verification_failed" });
      }
      if (verified.shop.domain !== shop) return fail("SHOPIFY_WRONG_STORE", { detail: "token_for_other_shop" });
      const scopes = verified.scopes.length ? verified.scopes : tokens.scopes;
      const live = assessScopes(scopes);
      if (live.write.length) return fail("SHOPIFY_WRITE_SCOPES_GRANTED", { scopes: live.write.join(",") });
      if (live.missing.length) return fail("SHOPIFY_MISSING_SCOPES", { missing: live.missing.join(",") });

      const encryptedCredentials = encryptCredentials(
        { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
        config.encryptionKey,
        credentialsContext(actor.workspaceId, shop),
      );
      const saved = await store.transaction(async (tx) => {
        const connection = await tx.connections.saveConnected({
          workspaceId: actor.workspaceId,
          provider: "SHOPIFY",
          externalAccountId: shop,
          displayName: verified.shop.name,
          scopes,
          encryptedCredentials,
          credentialsKeyVersion: CREDENTIALS_KEY_VERSION,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
          connectedAt: now,
          lastSyncedAt: now,
        });
        await tx.audit.record({
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          actorLabel: actor.name,
          action: "integration.connected",
          entityType: "integration",
          entityId: connection.id,
          metadata: { provider: "SHOPIFY", target: verified.shop.name, shop, scopes: scopes.join(",") },
        });
        return connection;
      });
      cache.clear("shopify:");
      logger("info", "shopify.oauth.connected", {
        shop,
        connection: saved.id,
        expiring: tokens.accessTokenExpiresAt !== null,
        scopes: scopes.join(","),
      });
      return { locale, result: "connected" };
    },

    /** Re-checks the stored token against Shopify (shop identity + granted scopes). Read-only. */
    async verify(actor: Actor): Promise<ShopifyConnectionView> {
      assertPermission(actor, "integration.manage");
      const config = requireReady();
      const current = await currentFor(actor.workspaceId, config);
      if (!current) throw new DomainError("SHOPIFY_NOT_CONNECTED");
      if (current.status === "ERROR") throw new DomainError(storedErrorCode(current));

      let result: Awaited<ReturnType<typeof runVerificationQuery>>;
      try {
        result = await runVerificationQuery(clientFor(current, config));
      } catch (error) {
        throw new DomainError(toShopifyErrorCode(error));
      }

      const scopes = assessScopes(result.scopes);
      if (result.shop.domain !== current.externalAccountId || scopes.write.length) {
        const code: DomainErrorCode = scopes.write.length ? "SHOPIFY_WRITE_SCOPES_GRANTED" : "SHOPIFY_RECONNECT_REQUIRED";
        await flagConnection(current, "verification_mismatch", { code });
        throw new DomainError(code);
      }
      if (scopes.missing.length) {
        await store.connections.updateIfStatus(actor.workspaceId, current.id, "CONNECTED", {
          lastError: "SHOPIFY_MISSING_SCOPES",
          scopes: result.scopes,
        });
        throw new DomainError("SHOPIFY_MISSING_SCOPES", { scopes: scopes.missing.join(", ") });
      }

      const latest = await store.connections.updateIfStatus(actor.workspaceId, current.id, "CONNECTED", {
        displayName: result.shop.name,
        scopes: result.scopes,
        lastSyncedAt: deps.now(),
        lastError: null,
      });
      await store.audit.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        actorLabel: actor.name,
        action: "integration.verified",
        entityType: "integration",
        entityId: current.id,
        metadata: { provider: "SHOPIFY", target: result.shop.name },
      });
      cache.clear(cachePrefix(current));
      return viewOf(latest ?? (await store.connections.get(actor.workspaceId, current.id)) ?? current, config);
    },

    /**
     * Forgets the stored token (credentials wiped, status REVOKED). It does not
     * uninstall the app from Shopify — that is a change in the merchant's admin.
     */
    async disconnect(actor: Actor): Promise<void> {
      assertPermission(actor, "integration.manage");
      const current = await store.connections.getCurrent(actor.workspaceId, "SHOPIFY");
      if (!current) throw new DomainError("SHOPIFY_NOT_CONNECTED");
      await store.transaction(async (tx) => {
        await tx.connections.update(actor.workspaceId, current.id, {
          status: "REVOKED",
          encryptedCredentials: null,
          credentialsKeyVersion: null,
          accessTokenExpiresAt: null,
          refreshTokenExpiresAt: null,
          lastError: null,
        });
        await tx.audit.record({
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          actorLabel: actor.name,
          action: "integration.disconnected",
          entityType: "integration",
          entityId: current.id,
          metadata: { provider: "SHOPIFY", target: current.displayName ?? current.externalAccountId },
        });
      });
      cache.clear(cachePrefix(current));
      logger("info", "shopify.connection.disconnected", { shop: current.externalAccountId });
    },

    /**
     * Which Shopify data a page should show. Demo data is only used while no store
     * is connected; once connected, a problem shows as an error — never as demo data.
     */
    async resolveSource(workspaceId: string): Promise<ShopifySource> {
      const readiness = deps.readiness();
      if (!readiness.ready) {
        return {
          mode: "demo",
          reason: readiness.reason === "storage_required" ? "storage_required" : "not_configured",
          service: demo,
        };
      }
      const stored = await currentFor(workspaceId, readiness.config);
      if (!stored) return { mode: "demo", reason: "not_connected", service: demo };
      const current = await ensureReadable(stored, readiness.config);
      if (current.status === "ERROR") {
        return { mode: "error", code: storedErrorCode(current), shopDomain: current.externalAccountId!, shopName: current.displayName };
      }
      return {
        mode: "live",
        shopDomain: current.externalAccountId!,
        shopName: current.displayName,
        service: new LiveShopifyService({
          client: clientFor(current, readiness.config),
          scopes: current.scopes,
          cache,
          cacheKey: `${cachePrefix(current)}${current.connectedAt?.getTime() ?? 0}`,
          now: deps.now,
        }),
      };
    },
  };
}

export type ShopifyConnectionService = ReturnType<typeof createShopifyConnectionService>;

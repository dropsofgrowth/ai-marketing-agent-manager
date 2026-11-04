/**
 * In-process stand-in for Shopify's OAuth token endpoint and GraphQL Admin API,
 * injected as `fetchImpl`. It mimics the behaviours the integration depends on:
 * single-use authorization codes, expiring offline tokens, rotating refresh tokens
 * (the old one stops working), 401 for unknown tokens, and cursor pagination.
 * No network access.
 */
import { createHmac } from "node:crypto";

export type FakeOrder = {
  processedAt: string;
  total: string;
  currency?: string;
  test?: boolean;
  cancelled?: boolean;
  lineItems?: { productId: string | null; quantity: number; total: string }[];
  name?: string;
  financial?: string | null;
  fulfillment?: string | null;
};

export type FakeProduct = {
  id: string;
  title: string;
  status?: string;
  price: string;
  totalInventory?: number;
  tracksInventory?: boolean;
};

type Json = Record<string, unknown>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export function createFakeShopify(options: {
  shop: string;
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  scopes?: string;
  shopName?: string;
  currency?: string;
  timezone?: string;
  now: () => Date;
}) {
  const state = {
    scopes: options.scopes ?? "read_orders,read_products",
    installationScopes: null as string[] | null,
    codes: new Set<string>(),
    accessTokens: new Map<string, number>(),
    refreshTokens: new Set<string>(),
    tokenRequests: [] as URLSearchParams[],
    graphqlRequests: [] as { token: string; operation: string; variables: Json }[],
    orders: [] as FakeOrder[],
    products: [] as FakeProduct[],
    /** Respond to the next N GraphQL calls with this instead. */
    graphqlOverrides: [] as (() => Response)[],
    /** Respond to the next token request with this instead. */
    tokenOverrides: [] as (() => Response)[],
    issueExpiring: true,
    /** Delay every refresh-token request by this long (concurrency tests). */
    refreshDelayMs: 0,
    counter: 0,
  };

  const shopNode = () => ({
    name: options.shopName ?? "Drops Of Growth",
    myshopifyDomain: options.shop,
    currencyCode: options.currency ?? "USD",
    ianaTimezone: options.timezone ?? "UTC",
  });

  function issueTokens(expiring: boolean) {
    state.counter += 1;
    const access = `shpat_fake_access_${state.counter}`;
    state.accessTokens.set(access, expiring ? options.now().getTime() + 3600_000 : Number.POSITIVE_INFINITY);
    if (!expiring) return { access_token: access, scope: state.scopes };
    const refresh = `shprt_fake_refresh_${state.counter}`;
    state.refreshTokens.add(refresh);
    return {
      access_token: access,
      scope: state.scopes,
      expires_in: 3600,
      refresh_token: refresh,
      refresh_token_expires_in: 7_776_000,
    };
  }

  function ordersPage(variables: Json, pageSize: number, select: (o: FakeOrder) => Json, reverse = false) {
    const query = String(variables.query ?? "");
    const match = /processed_at:>='([^']+)' AND processed_at:<'([^']+)'/.exec(query);
    let rows = [...state.orders].sort((a, b) => a.processedAt.localeCompare(b.processedAt));
    if (match) rows = rows.filter((o) => o.processedAt >= match[1] && o.processedAt < match[2]);
    if (reverse) rows.reverse();
    const start = variables.after ? Number(String(variables.after).replace("cursor_", "")) : 0;
    const first = Math.min(Number(variables.first ?? pageSize), 250);
    const slice = rows.slice(start, start + first);
    const next = start + slice.length;
    return {
      orders: {
        pageInfo: { hasNextPage: next < rows.length, endCursor: next < rows.length ? `cursor_${next}` : null },
        nodes: slice.map(select),
      },
    };
  }

  function graphql(operation: string, document: string, variables: Json): Json {
    switch (operation) {
      case "VerifyConnection":
        return {
          shop: shopNode(),
          currentAppInstallation: {
            accessScopes: (state.installationScopes ?? state.scopes.split(",")).map((handle) => ({ handle })),
          },
        };
      case "ShopInfo":
        return { shop: shopNode() };
      case "Products":
        return {
          products: {
            pageInfo: { hasNextPage: false },
            nodes: state.products.map((p) => ({
              id: p.id,
              title: p.title,
              status: p.status ?? "ACTIVE",
              ...(document.includes("totalInventory")
                ? { totalInventory: p.totalInventory ?? 0, tracksInventory: p.tracksInventory ?? true }
                : {}),
              priceRangeV2: { minVariantPrice: { amount: p.price, currencyCode: options.currency ?? "USD" } },
            })),
          },
        };
      case "RecentOrders": {
        const rows = [...state.orders].sort((a, b) => b.processedAt.localeCompare(a.processedAt)).slice(0, Number(variables.first));
        return {
          orders: {
            nodes: rows.map((o, i) => ({
              id: `gid://shopify/Order/${i + 1}`,
              name: o.name ?? `#${1000 + i}`,
              processedAt: o.processedAt,
              test: Boolean(o.test),
              displayFinancialStatus: o.financial === undefined ? "PAID" : o.financial,
              displayFulfillmentStatus: o.fulfillment === undefined ? "UNFULFILLED" : o.fulfillment,
              currentSubtotalLineItemsQuantity: (o.lineItems ?? []).reduce((n, li) => n + li.quantity, 0),
              currentTotalPriceSet: { shopMoney: { amount: o.total, currencyCode: o.currency ?? options.currency ?? "USD" } },
            })),
          },
        };
      }
      case "OrderTotals":
        return ordersPage(variables, 250, (o) => ({
          processedAt: o.processedAt,
          test: Boolean(o.test),
          cancelledAt: o.cancelled ? o.processedAt : null,
          currentTotalPriceSet: { shopMoney: { amount: o.total, currencyCode: o.currency ?? options.currency ?? "USD" } },
        }));
      case "OrderLineItems":
        return ordersPage(
          variables,
          30,
          (o) => ({
            test: Boolean(o.test),
            cancelledAt: o.cancelled ? o.processedAt : null,
            lineItems: {
              pageInfo: { hasNextPage: (o.lineItems ?? []).length > 5 },
              nodes: (o.lineItems ?? []).slice(0, 5).map((li) => ({
                quantity: li.quantity,
                product: li.productId ? { id: li.productId } : null,
                discountedTotalSet: { shopMoney: { amount: li.total, currencyCode: options.currency ?? "USD" } },
              })),
            },
          }),
          true,
        );
      default:
        throw new Error(`fake shopify: unknown operation ${operation}`);
    }
  }

  const fetchImpl = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    if (url.host !== options.shop) throw new TypeError("fetch failed (unknown host)");

    if (url.pathname === "/admin/oauth/access_token") {
      const body = new URLSearchParams(String(init.body));
      state.tokenRequests.push(body);
      const override = state.tokenOverrides.shift();
      if (override) return override();
      if (body.get("client_id") !== options.clientId || body.get("client_secret") !== options.clientSecret) {
        return json(401, { error: "invalid_client" });
      }
      if (body.get("grant_type") === "refresh_token") {
        if (state.refreshDelayMs) await new Promise((resolve) => setTimeout(resolve, state.refreshDelayMs));
        const refresh = body.get("refresh_token") ?? "";
        if (!state.refreshTokens.has(refresh)) return json(401, { error: "invalid_request" });
        state.refreshTokens.delete(refresh); // rotation: the old refresh token is now invalid
        return json(200, issueTokens(true));
      }
      const code = body.get("code") ?? "";
      if (!state.codes.has(code)) return json(400, { error: "invalid_request" });
      state.codes.delete(code); // single use
      return json(200, issueTokens(state.issueExpiring && body.get("expiring") === "1"));
    }

    if (url.pathname === `/admin/api/${options.apiVersion}/graphql.json`) {
      const headers = init.headers as Record<string, string>;
      const token = headers["X-Shopify-Access-Token"] ?? "";
      const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Json };
      const operation = /query\s+(\w+)/.exec(query)?.[1] ?? "anonymous";
      state.graphqlRequests.push({ token, operation, variables });
      const override = state.graphqlOverrides.shift();
      if (override) return override();
      const expiresAt = state.accessTokens.get(token);
      if (expiresAt === undefined || expiresAt <= options.now().getTime()) {
        return json(401, { errors: "[API] Invalid API key or access token (unrecognized login or wrong password)" });
      }
      return json(
        200,
        { data: graphql(operation, query, variables), extensions: { cost: { requestedQueryCost: 10, actualQueryCost: 5 } } },
        { "x-request-id": `req-${state.graphqlRequests.length}`, "x-shopify-api-version": options.apiVersion },
      );
    }
    return json(404, { errors: "Not Found" });
  };

  /** Issues a one-time code and returns callback params signed like Shopify does. */
  function callbackParams(input: { state: string; shop?: string; timestamp?: Date; code?: string; secret?: string }) {
    const code = input.code ?? `code_${Math.random().toString(36).slice(2)}`;
    state.codes.add(code);
    const params: Record<string, string> = {
      code,
      host: Buffer.from(`admin.shopify.com/store/${options.shop.split(".")[0]}`).toString("base64url"),
      shop: input.shop ?? options.shop,
      state: input.state,
      timestamp: String(Math.floor((input.timestamp ?? options.now()).getTime() / 1000)),
    };
    const message = new URLSearchParams(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1))).toString();
    const hmac = createHmac("sha256", input.secret ?? options.clientSecret).update(message).digest("hex");
    return new URLSearchParams({ ...params, hmac });
  }

  return { state, fetchImpl, callbackParams };
}

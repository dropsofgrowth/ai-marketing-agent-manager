/**
 * TEST HARNESS ONLY — simulates Shopify for `npm run test:shopify-flow`.
 *
 * Loaded with `node --import` into a local `next start`, it routes server-side
 * fetches for SHOPIFY_STORE_DOMAIN to an in-process fake (OAuth token endpoint +
 * GraphQL Admin API) so the real connect flow can be exercised without contacting
 * Shopify. It refuses to load unless E2E_FAKE_SHOPIFY=1 and the store domain ends
 * in "-e2e.myshopify.com", so it can't intercept a real store by accident.
 */
import { appendFileSync } from "node:fs";

if (process.env.E2E_FAKE_SHOPIFY !== "1") throw new Error("fake-shopify-preload: set E2E_FAKE_SHOPIFY=1 to use it");
const SHOP = process.env.SHOPIFY_STORE_DOMAIN || "";
if (!SHOP.endsWith("-e2e.myshopify.com")) throw new Error("fake-shopify-preload: SHOPIFY_STORE_DOMAIN must end in -e2e.myshopify.com");

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const VERSION = process.env.SHOPIFY_API_VERSION || "2026-10";
const LOG = process.env.E2E_FAKE_SHOPIFY_LOG;
const realFetch = globalThis.fetch;

const tokens = new Map(); // access token -> expiry ms
const refreshTokens = new Set();
let counter = 0;

const record = (entry) => LOG && appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SHOP_NODE = { name: "Drops Of Growth (E2E fake)", myshopifyDomain: SHOP, currencyCode: "AED", ianaTimezone: "Asia/Dubai" };
const PRODUCTS = [
  { id: "gid://shopify/Product/1", title: "Rose Glow Serum", status: "ACTIVE", price: "149.00" },
  { id: "gid://shopify/Product/2", title: "عطر العود الملكي", status: "ACTIVE", price: "320.00" },
  { id: "gid://shopify/Product/3", title: "Hydra Mist", status: "ACTIVE", price: "59.50" },
  { id: "gid://shopify/Product/4", title: "Gift Box (draft)", status: "DRAFT", price: "99.00" },
];

/** Deterministic orders: ~3 per day for the last 75 days. */
function orders() {
  const out = [];
  const end = Date.now();
  for (let i = 0; i < 225; i++) {
    const at = new Date(end - i * 8 * 3_600_000 - 1_800_000);
    const product = PRODUCTS[i % 3];
    const qty = 1 + (i % 2);
    const total = (Number(product.price) * qty + 15).toFixed(2);
    out.push({
      id: `gid://shopify/Order/${9000 + i}`,
      name: `#${9000 + i}`,
      processedAt: at.toISOString(),
      test: i === 4,
      cancelledAt: i === 7 ? at.toISOString() : null,
      financial: ["PAID", "PAID", "PENDING", "PARTIALLY_REFUNDED"][i % 4],
      fulfillment: ["UNFULFILLED", "FULFILLED", "PARTIALLY_FULFILLED"][i % 3],
      total,
      lineItems: [{ productId: product.id, quantity: qty, total: (Number(product.price) * qty).toFixed(2) }],
    });
  }
  return out;
}

function page(variables, select, reverse) {
  const match = /processed_at:>='([^']+)' AND processed_at:<'([^']+)'/.exec(String(variables.query || ""));
  let rows = orders().sort((a, b) => a.processedAt.localeCompare(b.processedAt));
  if (match) rows = rows.filter((o) => o.processedAt >= match[1] && o.processedAt < match[2]);
  rows = rows.filter((o) => Date.now() - Date.parse(o.processedAt) <= 60 * 86_400_000); // no read_all_orders
  if (reverse) rows.reverse();
  const start = variables.after ? Number(String(variables.after).slice(2)) : 0;
  const slice = rows.slice(start, start + Number(variables.first || 50));
  const next = start + slice.length;
  return {
    orders: {
      pageInfo: { hasNextPage: next < rows.length, endCursor: next < rows.length ? `c_${next}` : null },
      nodes: slice.map(select),
    },
  };
}

function graphql(operation, query, variables) {
  const money = (amount) => ({ shopMoney: { amount, currencyCode: "AED" } });
  switch (operation) {
    case "VerifyConnection":
      return { shop: SHOP_NODE, currentAppInstallation: { accessScopes: [{ handle: "read_orders" }, { handle: "read_products" }] } };
    case "ShopInfo":
      return { shop: SHOP_NODE };
    case "Products":
      return {
        products: {
          pageInfo: { hasNextPage: false },
          nodes: PRODUCTS.map((p) => ({ id: p.id, title: p.title, status: p.status, priceRangeV2: { minVariantPrice: { amount: p.price, currencyCode: "AED" } } })),
        },
      };
    case "RecentOrders":
      return {
        orders: {
          nodes: orders().slice(0, Number(variables.first)).map((o) => ({
            id: o.id,
            name: o.name,
            processedAt: o.processedAt,
            test: o.test,
            displayFinancialStatus: o.financial,
            displayFulfillmentStatus: o.fulfillment,
            currentSubtotalLineItemsQuantity: o.lineItems[0].quantity,
            currentTotalPriceSet: money(o.total),
          })),
        },
      };
    case "OrderTotals":
      return page(variables, (o) => ({ processedAt: o.processedAt, test: o.test, cancelledAt: o.cancelledAt, currentTotalPriceSet: money(o.total) }), false);
    case "OrderLineItems":
      return page(
        variables,
        (o) => ({
          test: o.test,
          cancelledAt: o.cancelledAt,
          lineItems: {
            pageInfo: { hasNextPage: false },
            nodes: o.lineItems.map((li) => ({ quantity: li.quantity, product: { id: li.productId }, discountedTotalSet: money(li.total) })),
          },
        }),
        true,
      );
    default:
      throw new Error(`fake shopify: unknown operation ${operation}`);
  }
}

function issue() {
  counter += 1;
  const access = `shpat_e2e_access_${counter}`;
  const refresh = `shprt_e2e_refresh_${counter}`;
  tokens.set(access, Date.now() + 3_600_000);
  refreshTokens.add(refresh);
  return { access_token: access, scope: "read_orders,read_products", expires_in: 3600, refresh_token: refresh, refresh_token_expires_in: 7_776_000 };
}

globalThis.fetch = async function fakeShopifyFetch(input, init = {}) {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.host !== SHOP) return realFetch(input, init);
  const body = String(init.body || "");

  if (url.pathname === "/admin/oauth/access_token") {
    const params = new URLSearchParams(body);
    if (params.get("client_id") !== CLIENT_ID || params.get("client_secret") !== CLIENT_SECRET) return json(401, { error: "invalid_client" });
    if (params.get("grant_type") === "refresh_token") {
      const refresh = params.get("refresh_token");
      record({ kind: "token", grant: "refresh_token" });
      if (!refreshTokens.delete(refresh)) return json(401, { error: "invalid_request" });
      return json(200, issue());
    }
    const code = params.get("code") || "";
    record({ kind: "token", grant: "authorization_code", expiring: params.get("expiring") });
    if (!code.startsWith("e2e_code_")) return json(400, { error: "invalid_request" });
    return json(200, issue());
  }

  if (url.pathname === `/admin/api/${VERSION}/graphql.json`) {
    const headers = init.headers || {};
    const token = headers["X-Shopify-Access-Token"];
    const { query, variables } = JSON.parse(body);
    const operation = (/query\s+(\w+)/.exec(query) || [])[1] || "anonymous";
    const mutation = /\bmutation\b/.test(query);
    record({ kind: "graphql", operation, mutation });
    if (mutation) return json(400, { errors: [{ message: "fake shopify: mutations are never expected" }] });
    if (!tokens.has(token) || tokens.get(token) < Date.now()) return json(401, { errors: "Invalid API key or access token" });
    return json(200, { data: graphql(operation, query, variables || {}), extensions: { cost: { requestedQueryCost: 10 } } });
  }
  return json(404, { errors: "Not Found" });
};

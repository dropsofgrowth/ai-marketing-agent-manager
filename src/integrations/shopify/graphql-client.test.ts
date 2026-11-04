import { describe, expect, it, vi } from "vitest";

import {
  ShopifyApiError,
  assertReadOnlyDocument,
  createShopifyGraphqlClient,
} from "@/integrations/shopify/graphql-client";
import type { FetchLike } from "@/integrations/shopify/oauth";
import { createMemoryLogger } from "@/server/logging";

const TOKEN = "shpat_super_secret_token";
const ok = (data: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ data, ...extra }), { status: 200 });

function client(responses: (() => Response)[], options: { tokens?: string[] } = {}) {
  const calls: { headers: Record<string, string>; body: string }[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    calls.push({ headers: init.headers as Record<string, string>, body: String(init.body) });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  };
  const tokens = options.tokens ?? [TOKEN];
  let current = 0;
  // A forced refresh moves on to the next token, if the test provided one.
  const getAccessToken = vi.fn(async ({ forceRefresh }: { forceRefresh: boolean }) => {
    if (forceRefresh && current < tokens.length - 1) current += 1;
    return tokens[current];
  });
  const logger = createMemoryLogger();
  const sleep = vi.fn(async () => {});
  const instance = createShopifyGraphqlClient({
    shop: "drops-of-growth.myshopify.com",
    apiVersion: "2026-10",
    getAccessToken,
    fetchImpl,
    logger,
    sleep,
  });
  return { instance, calls, getAccessToken, logger, sleep };
}

describe("read-only guard", () => {
  it("only allows query operations", () => {
    expect(() => assertReadOnlyDocument("query Shop { shop { name } }")).not.toThrow();
    expect(() => assertReadOnlyDocument("{ shop { name } }")).not.toThrow();
    expect(() => assertReadOnlyDocument("mutation { productDelete(input: {id: 1}) { deletedProductId } }")).toThrow();
    expect(() => assertReadOnlyDocument("query A { shop { name } } mutation B { x }")).toThrow();
    expect(() => assertReadOnlyDocument("# comment\nsubscription S { x }")).toThrow();
  });

  it("never sends a mutation to Shopify", async () => {
    const { instance, calls } = client([() => ok({})]);
    await expect(instance.query("Evil", "mutation { orderCancel(orderId: 1) { job { id } } }")).rejects.toThrow(/read-only/);
    expect(calls).toHaveLength(0);
  });
});

describe("graphql client", () => {
  it("sends the token only in the X-Shopify-Access-Token header and never logs it", async () => {
    const { instance, calls, logger } = client([
      () => new Response("{}", { status: 503 }),
      () => ok({ shop: { name: "Drops" } }),
    ]);
    await expect(instance.query("ShopInfo", "query ShopInfo { shop { name } }")).resolves.toEqual({ shop: { name: "Drops" } });
    expect(calls[1].headers["X-Shopify-Access-Token"]).toBe(TOKEN);
    expect(calls[1].body).not.toContain(TOKEN);
    expect(logger.lines.join("\n")).not.toContain(TOKEN);
  });

  it("waits for the leaky bucket on THROTTLED, then retries", async () => {
    const throttled = () =>
      ok(null, {
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: { cost: { requestedQueryCost: 300, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 100, restoreRate: 100 } } },
      });
    const { instance, sleep } = client([throttled, () => ok({ shop: { name: "Drops" } })]);
    await instance.query("ShopInfo", "query ShopInfo { shop { name } }");
    expect(sleep).toHaveBeenCalledWith(2000); // (300 - 100) / 100 per second
  });

  it("forces one token refresh after a 401, then reports UNAUTHORIZED", async () => {
    const unauthorized = () => new Response(JSON.stringify({ errors: "Invalid API key or access token" }), { status: 401 });
    const recovered = client([unauthorized, () => ok({ shop: { name: "Drops" } })], { tokens: ["old", "new"] });
    await recovered.instance.query("ShopInfo", "query ShopInfo { shop { name } }");
    expect(recovered.getAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect(recovered.calls[1].headers["X-Shopify-Access-Token"]).toBe("new");

    const revoked = client([unauthorized, unauthorized]);
    await expect(revoked.instance.query("ShopInfo", "query ShopInfo { shop { name } }")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("maps ACCESS_DENIED and other GraphQL errors, failing closed on partial data", async () => {
    const denied = client([
      () => ok({ products: null }, { errors: [{ message: "Access denied for totalInventory field.", path: ["products"], extensions: { code: "ACCESS_DENIED" } }] }),
    ]);
    await expect(denied.instance.query("Products", "query Products { products(first: 1) { nodes { id } } }")).rejects.toMatchObject({
      code: "ACCESS_DENIED",
    });
    expect(denied.logger.lines.join("\n")).toContain('"graphqlCode":"ACCESS_DENIED"');

    const invalid = client([() => ok(null, { errors: [{ message: "Field 'nope' doesn't exist", extensions: { code: "undefinedField" } }] })]);
    await expect(invalid.instance.query("Q", "query Q { nope }")).rejects.toBeInstanceOf(ShopifyApiError);
  });

  it("gives up after repeated server errors", async () => {
    const down = () => new Response("bad gateway", { status: 502 });
    const { instance, sleep } = client([down, down, down, down]);
    await expect(instance.query("ShopInfo", "query ShopInfo { shop { name } }")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(sleep).toHaveBeenCalledTimes(3);
  });
});

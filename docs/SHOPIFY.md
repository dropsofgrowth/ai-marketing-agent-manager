# Shopify integration (Phase 2: read-only)

The dashboard can connect to **one** Shopify store and read its orders and products.
It never changes anything in Shopify: it sends only GraphQL `query` operations, and it
refuses to store a token that has any `write_*` permission.

> **Status:** implemented and tested against a simulated Shopify (unit tests and an
> end-to-end browser test). It has **not yet been exercised against the real
> Shopify API** — the first real connection is the remaining verification step.

---

## 1. Which authentication flow, and why

Your app ("Drops of Growth AI Marketing Agent") was created in the **Shopify Dev
Dashboard** and installed on the live store. The dashboard runs on its own website,
outside the Shopify admin. Shopify offers three ways to get an Admin API token:

| Flow | When Shopify allows it | Fits this app? |
| --- | --- | --- |
| **Authorization code grant** (OAuth redirect) | Non-embedded apps installed on a store — any store the app is installed on. | **Yes — implemented.** |
| Token exchange | Embedded apps only (runs inside the Shopify admin with App Bridge). | No: this dashboard is not embedded. |
| Client credentials grant | Only when the app **and** the store belong to the **same Shopify organization**. Tokens expire after 24 h. | **Not assumed.** The Dev Dashboard *Stores* page showed "No stores yet", which indicates the live store is not in the app's organization. |

**Can I confirm the organization question?** Not from here — this repository and
session have no access to your Shopify accounts. To check it yourself: open
<https://dev.shopify.com>, pick the organization that owns the app, and open
**Stores**. If the Drops Of Growth store is not listed there, the app and store are in
different organizations and client credentials cannot be used. The implemented flow
works **either way**, so nothing depends on the answer.

**Token lifecycle.** The code requests an *expiring offline token* (`expiring=1`):

- the **access token** lasts 1 hour and is refreshed automatically 5 minutes before expiry;
- the **refresh token** lasts 90 days and **rotates** — every refresh returns a new one
  and invalidates the old one, so it is saved before the new access token is used;
- refreshes run under a database row lock (`SELECT … FOR UPDATE`), so two servers can
  never spend the same refresh token;
- if Shopify rejects the refresh token (expired, or the app was uninstalled), the stored
  credentials are wiped and the dashboard shows **"Reconnect Shopify"** — it never falls
  back to demo data once a store has been connected.

Shopify's own docs: [authorization code grant](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant),
[access tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens),
[expiring offline tokens](https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens).

---

## 2. Environment variables

All of these are **server-side only**. Never add `NEXT_PUBLIC_` to them, never paste
them into chat, an issue or a pull request, and never commit them.

| Name | Secret? | Where to find it | Example |
| --- | --- | --- | --- |
| `SHOPIFY_CLIENT_ID` | No (but keep server-side) | Dev Dashboard → your app → **Settings** → Client ID | `a1b2c3…` |
| `SHOPIFY_CLIENT_SECRET` | **Yes** | Dev Dashboard → your app → **Settings** → Secret | — |
| `SHOPIFY_STORE_DOMAIN` | No | Shopify admin → Settings → Domains (the `*.myshopify.com` one) | `drops-of-growth.myshopify.com` |
| `SHOPIFY_API_VERSION` | No | Optional. Pinned Admin API version; default `2026-10`. | `2026-10` |
| `APP_URL` | No | The dashboard's public **https** address (no trailing path). | `https://agent.dropsofgrowth.com` |
| `DATABASE_URL` | **Yes** | Your PostgreSQL provider (e.g. Neon). Tokens are stored here, encrypted. | — |
| `CREDENTIALS_ENCRYPTION_KEY` | **Yes** | Generate once: `openssl rand -base64 32`. Losing it means reconnecting Shopify. | — |
| `DASHBOARD_BASIC_AUTH_USER` / `_PASSWORD` | **Yes** (password) | Choose them. Strongly recommended until real sign-in exists. | — |

The Settings page shows which of these are **missing by name** (never their values).

### Where to put them

- **Vercel:** Project → **Settings → Environment Variables**. Add each one, tick
  **Production** (and Preview only if previews use a separate database), and mark the
  secrets as **Sensitive**. Redeploy afterwards.
- **Render:** Service → **Environment** → add the variables (or a secret file) → redeploy.
- **Your computer:** a `.env.local` file in the project folder (git-ignored). Use
  `APP_URL=http://localhost:3000` only for local testing.

---

## 3. Dev Dashboard settings for the app

In the Dev Dashboard → your app → **Versions** → create a new version:

1. **App URL:** `https://<your APP_URL>/en/settings`
2. **Embed app in Shopify admin:** off (the dashboard refuses to be framed).
3. **Allowed redirection URL(s):** `https://<your APP_URL>/api/integrations/shopify/callback`
   — must match exactly. The Settings page shows the exact value under
   *Redirect URL for the Dev Dashboard*.
4. **Scopes:** `read_orders`, `read_products` only. (Optional, read-only:
   `read_all_orders` for history older than 60 days, `read_inventory` for stock levels.)
5. **Release** the version.

## 4. Connect

1. Open the dashboard **at its `APP_URL` address** (the state cookie is tied to it).
2. Settings → **Shopify connection** → **Connect Shopify**.
3. Shopify shows the read-only permissions (or returns immediately if already approved).
4. You land back on Settings with "Shopify connected". The Shopify, Overview and
   Analytics pages now show live data, labelled **"Shopify: live · <store name>"**.
5. **Verify connection** re-checks the store and the granted scopes at any time.
   **Disconnect** deletes the stored token (uninstall the app in the Shopify admin to
   revoke access completely).

---

## 5. What the data means (and its limits)

| Metric | Definition |
| --- | --- |
| Revenue | Sum of `currentTotalPriceSet` (shop currency): order totals incl. tax and shipping, after refunds/edits. Cancelled and test orders are excluded. |
| Orders / AOV | Count of those orders; revenue ÷ orders. |
| Days | Bucketed by the **store's time zone**, by `processedAt`. |
| Product units / revenue | From order line items (`quantity`, `discountedTotalSet`): after line-item discounts, before refunds. Based on up to the 420 most recent orders of the period — the page says so when it's partial. |
| Conversion rate | **Not available** (needs Shopify analytics/sessions access). Shown as "—". |
| Inventory | Only with `read_inventory`; otherwise "—" (never a misleading 0). |
| Customer names, order source | **Not requested** (protected customer data). |
| Order history | Last **60 days** without `read_all_orders`; older periods are flagged as partial and their % change is hidden. |
| Blended ROAS, "Revenue vs. ad spend" | **Hidden** while Meta Ads is still demo data — real revenue is never divided by sample ad spend. |

Results are cached in memory for up to 5 minutes (1 minute for recent orders) to stay
well inside Shopify's rate limits; each page view reads at most 20 pages of orders.

---

## 6. Security summary

- **Secrets:** client secret and tokens exist only on the server. The browser receives
  only the public authorize URL and a signed, httpOnly, 10-minute state cookie.
- **Callback checks (all before the code is redeemed):** permission (owner/admin),
  signed state cookie + `state` match, Shopify HMAC (client secret, constant-time),
  timestamp freshness, shop = `SHOPIFY_STORE_DOMAIN`. The token is then tested against
  the store and its scopes checked before it is saved.
- **Storage:** AES-256-GCM, bound to the workspace + store; PostgreSQL CHECK constraints
  reject anything that isn't ciphertext and keep at most one current connection.
- **Logging:** structured events with codes, operation names and Shopify request ids.
  Token-shaped strings and secret-named fields are stripped (`src/server/logging.ts`).
- **Read-only:** `assertReadOnlyDocument` blocks `mutation`/`subscription`; tokens with
  `write_*` scopes are refused at connect and revoked on verify.
- **Audit log:** connected / verified / disconnected / needs-attention events.

## 7. Troubleshooting (result codes on the Settings page)

| Message | What to check |
| --- | --- |
| Setup needed — missing `SHOPIFY_…` | Environment variables (section 2), then redeploy. |
| Needs `DATABASE_URL` / `CREDENTIALS_ENCRYPTION_KEY` | Tokens are only stored encrypted in PostgreSQL. |
| "Open the dashboard at its configured address (APP_URL)" | You opened a preview/other domain; use `APP_URL`. |
| Request expired / didn't start from this browser | Took > 10 minutes, or cookies blocked. Try again. |
| Response couldn't be verified | `SHOPIFY_CLIENT_SECRET` doesn't match the app. |
| Shopify didn't issue an access token | Client ID/secret, redirect URL (section 3), app installed on the store. |
| Different store than `SHOPIFY_STORE_DOMAIN` | Fix the domain variable or connect from the right store. |
| App was granted write access | Remove `write_*` scopes in the Dev Dashboard, release, reconnect. |
| Reconnect needed | Refresh token expired (unused 90 days) or app uninstalled. Click **Reconnect**. |

Server logs use events named `shopify.*` (e.g. `shopify.oauth.callback_rejected` with an
`errorCode`, `shopify.graphql.failed` with `requestId`).

## 8. Tests

All of the below also run automatically on every pull request (`.github/workflows/ci.yml`).

```bash
npm run check                      # lint + types + unit tests (OAuth, HMAC, refresh, adapter, service)
```

Repository integration test (needs a disposable, migrated PostgreSQL):

```bash
TEST_DATABASE_URL=postgresql://… npx vitest run src/server/store/prisma-connections.test.ts
```

End-to-end connect flow with a **simulated** Shopify (no request reaches Shopify):

```bash
npm run build
APP_URL=http://localhost:3101 DATABASE_URL=postgresql://… CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -base64 32) \
SHOPIFY_CLIENT_ID=e2e-id SHOPIFY_CLIENT_SECRET=e2e-secret SHOPIFY_STORE_DOMAIN=demo-e2e.myshopify.com \
E2E_FAKE_SHOPIFY=1 NODE_OPTIONS="--import ./e2e/fake-shopify-preload.mjs" npx next start -p 3101
```

```bash
BASE_URL=http://localhost:3101 SHOPIFY_STORE_DOMAIN=demo-e2e.myshopify.com SHOPIFY_CLIENT_SECRET=e2e-secret npm run test:shopify-flow
```

The fake only loads with `E2E_FAKE_SHOPIFY=1` and a store domain ending in
`-e2e.myshopify.com`, so it cannot intercept a real store.

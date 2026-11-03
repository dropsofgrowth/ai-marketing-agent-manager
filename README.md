# AI Marketing & E-commerce Agent

A dashboard for running Meta Ads, a Shopify store and AI-generated creatives (Higgsfield AI)
from one place — in **English and Arabic (RTL)** — where **every budget change and every creative
publish must be approved by a person** before anything runs.

> **Status: Phase 2 — responsive, installable dashboard.** Works on iPhone, Android, tablets,
> Windows and Mac, in English and Arabic, and installs as an app (PWA). All three integrations
> still run on **deterministic mock data**: no request is sent to Meta, Shopify or Higgsfield,
> no live integration is complete, and approved changes can only be executed as **simulations**.
> Live adapters require real credentials, API permissions and review
> (see [Roadmap](#roadmap-to-live-integrations)).

## What's included

| Area | Phase 1 |
| --- | --- |
| **Dashboard** | Overview, Meta Ads, Shopify, AI Creatives, Analytics, Automations, Approvals, Settings. Light/dark (follows OS). |
| **Mobile & desktop** | Phone tab bar + "More" sheet, tablet icon rail, desktop sidebar; touch-friendly charts, KPI tiles with sparklines, tables that become card lists on phones, bottom-sheet dialogs, safe areas for notches. See [Responsive design](#responsive-design). |
| **Installable app (PWA)** | Localized web-app manifest (en/ar), icons incl. maskable + Apple touch icon, a minimal service worker with an offline page, an "Install as app" card in Settings, an offline banner. |
| **i18n** | English + Arabic with full RTL layout, `/en/...` and `/ar/...` routes, language switcher, locale detection (cookie → `Accept-Language` → `DEFAULT_LOCALE`). |
| **Integrations** | Typed service interfaces for Meta Ads, Shopify (read-only) and Higgsfield, each with a deterministic mock adapter. |
| **Approval workflow** | Budget changes and creative publishing: request → approve/reject → explicit simulated run. Guardrails, risk levels, expiry, optimistic locking, audit log. |
| **Automations** | "Scale winners" / "Trim losers" rules that **only propose** changes as pending approvals. |
| **Data** | PostgreSQL + Prisma 7 schema and migration (with safety CHECK constraints), seed data. Falls back to an in-memory demo store when `DATABASE_URL` is unset. |
| **Security** | Validated server-only env, AES-256-GCM helper for credentials at rest, optional HTTP Basic Auth, security headers, zod-validated server actions with role checks. |
| **Quality** | ESLint, strict TypeScript, 49 unit tests (Vitest), a responsive/PWA smoke test across 9 device profiles × 2 languages (Playwright). |

## Tech stack

Next.js 16 (App Router, Turbopack, Cache Components) · React 19 · TypeScript 5.9 · Tailwind CSS 4 ·
PostgreSQL · Prisma 7 (`@prisma/adapter-pg`) · zod 4 · lucide-react · Vitest.

Requires **Node.js ≥ 20.19** (22 LTS recommended) and npm.

---

## Quick start (no database needed)

```bash
git clone <this repo> && cd ai-marketing-agent
npm install                # also runs `prisma generate`
cp .env.example .env       # all values may stay empty for a demo
npm run dev
```

Open <http://localhost:3000> — you'll be redirected to `/en` or `/ar`.
Without `DATABASE_URL` the app uses an **in-memory demo store** pre-filled with sample data
(changes reset when the server restarts; a banner says so).

## Local development with PostgreSQL

1. **Start PostgreSQL** (any 14+ instance). With Docker:

   ```bash
   docker run --name marketing-agent-db -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=ai_marketing_agent -p 5432:5432 -d postgres:16
   ```

2. **Configure** `.env`:

   ```bash
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_marketing_agent?schema=public
   CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -base64 32)   # paste the generated value
   ```

3. **Create the schema and sample data**:

   ```bash
   npm run db:migrate   # development: applies migrations (prisma migrate dev)
   npm run db:seed      # idempotent: only seeds an empty demo workspace
   ```

4. `npm run dev` → <http://localhost:3000>. Check <http://localhost:3000/api/health>
   (`"storage": {"kind": "postgres", "status": "ok"}`).

Use `npm run db:studio` to browse the data.

## Preview a production build

> **Shareable HTTPS preview (iPhone + computer):** see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**
> — Vercel (a preview URL per pull request), Render, or a temporary Cloudflare tunnel from your computer.

```bash
npm run build
npm start                  # http://localhost:3000
```

For a shared preview deployment:

- Set `DASHBOARD_BASIC_AUTH_USER` and `DASHBOARD_BASIC_AUTH_PASSWORD` — every page and server
  action then requires them (there is **no user sign-in yet**; everyone acts as the demo owner).
- Use `npm run db:deploy` (not `db:migrate`) to apply migrations in non-development environments.
- `/api/health` stays public for load-balancer checks and reveals no configuration.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server (Turbopack). |
| `npm run build` / `npm start` | Production build / serve it. |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript rules). |
| `npm run typecheck` | Generate route types, then `tsc --noEmit`. |
| `npm test` | Unit tests (Vitest). `npm run test:watch` for watch mode. |
| `npm run check` | lint + typecheck + tests. |
| `npm run test:responsive` | Responsive + PWA smoke test against a running server (`BASE_URL`, optional `BASIC_AUTH=user:pass`, `SCREENSHOTS=dir`). First run: `npx playwright install chromium`. |
| `npm run pwa:assets` | Regenerate PWA icons and `public/offline.html` (after changing the logo or the `offline` strings). |
| `npm run db:migrate` | Create/apply migrations in development. |
| `npm run db:deploy` | Apply committed migrations (CI/production). |
| `npm run db:seed` | Seed demo workspace (skips if it already has data). |
| `npm run db:generate` | Regenerate the Prisma client. |

## Environment variables

See [`.env.example`](.env.example) for the full, commented template. Never commit `.env`.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | No | PostgreSQL URL. Empty → in-memory demo store. |
| `CREDENTIALS_ENCRYPTION_KEY` | For storing credentials | 32-byte base64 key (`openssl rand -base64 32`). |
| `DASHBOARD_BASIC_AUTH_USER` / `_PASSWORD` | Recommended for previews | Enables HTTP Basic Auth on all pages and actions. |
| `DEFAULT_LOCALE` | No | `en` (default) or `ar`. |
| `LIVE_EXECUTION_ENABLED` | No | Keep `false`. No live adapters exist; if `true`, runs are still simulated and flagged. |
| `BUDGET_MAX_INCREASE_PERCENT` / `_DECREASE_PERCENT` | No | Per-request limits (defaults 50 / 80). |
| `BUDGET_MAX_DAILY_AMOUNT` | No | Daily budget ceiling in major units (default 5000). |
| `APPROVAL_TTL_HOURS` | No | Pending requests expire after this (default 72). |
| `REQUIRE_SEPARATE_APPROVER` | No | Four-eyes rule. Recommended `true` once real users exist. |
| `META_*`, `SHOPIFY_*`, `HIGGSFIELD_*` | No | Placeholders for Phase 2. Settings shows whether they're present (never their values); they do **not** switch on live data. |

## How the approval workflow keeps you safe

```
 request (person or automation)          explicit human action             explicit human action
           │                                     │                                   │
           ▼                                     ▼                                   ▼
       PENDING ──── approve ────▶ APPROVED ──── run ────▶ EXECUTING ──▶ EXECUTED │ FAILED
           │  └─ reject ─▶ REJECTED     └─ withdraw ─▶ CANCELLED          (SIMULATED in phase 1)
           ├─ withdraw ─▶ CANCELLED
           └─ ttl ──────▶ EXPIRED
```

- **Nothing executes on request or on approval.** Running an approved change is a separate click,
  and in Phase 1 it calls mock adapters with `dryRun: true` only.
- **Defense in depth for "no live changes":**
  - `MutationOptions.dryRun` is the literal type `true` — live calls don't compile.
  - Mock adapters throw on anything but a dry run; the executor rejects non-simulated results.
  - A database CHECK constraint only permits `execution_mode = 'SIMULATED'`.
  - Another CHECK forbids automations with `requires_approval = false`.
- **Guardrails:** per-request max increase/decrease, a daily ceiling, risk levels (low/medium/high),
  current budget read from the platform (never trusted from the browser).
- **Integrity:** compare-and-set transitions (`version` column) prevent double approval/execution;
  a partial unique index allows only one open request per target; every step is in `audit_logs`.
- **Permissions:** `OWNER`, `ADMIN`, `APPROVER`, `EDITOR`, `VIEWER` roles are enforced in the
  service layer. Phase 1 has a single demo **owner** until authentication is added.

## Project structure

```
docs/DEPLOYMENT.md         HTTPS preview deployment (Vercel / Render / tunnel) + installing the app
e2e/responsive.mjs         Responsive + PWA smoke test (Playwright)
public/                    sw.js, offline.html, icons/ (generated by scripts/generate-pwa-assets.ts)
prisma/
  schema.prisma            Data model (workspaces, users, roles, connections, creatives,
                           approval requests, automations, audit log)
  migrations/              SQL migrations incl. hand-written safety constraints
  seed.ts                  Demo data seed
src/
  app/[lang]/              Localized routes (layout sets <html lang dir>)
    page.tsx               Overview
    meta-ads/ shopify/ creatives/ analytics/ automations/ approvals/ settings/
  app/api/health/          Health probe
  proxy.ts                 Locale redirect + optional Basic Auth (Next 16 "proxy")
  components/              UI (ui/, layout/, charts/, approvals/, creatives/, automations/, settings/)
  lib/pwa/                 Manifest builder + client-side install/service-worker helpers
  domain/                  Framework-free business rules: types, state machine, guardrails,
                           permissions, automation rules, money
  integrations/            Service contracts + mock adapters
    meta-ads/ shopify/ higgsfield/   types.ts (interface) + mock.ts
    registry.ts            Chooses adapters (mock-only in phase 1)
  i18n/                    Locales, dictionaries (en/ar), formatters, bidi helpers
  server/
    env.ts                 Validated, server-only configuration
    store/                 DataStore interface: Prisma + in-memory implementations
    services/              Approval, automation and creative services
    actions/               Server actions (zod-validated, permission-checked)
    approvals/executor.ts  Runs APPROVED requests (dry run only)
    security/encryption.ts AES-256-GCM for credentials at rest
    auth/actor.ts          PLACEHOLDER demo identity — replace with real auth
```

## Responsive design

| Width | Navigation | Notes |
| --- | --- | --- |
| Phones (< 768 px) | Bottom tab bar (Overview, Ads, Shopify, Approvals, More) + "More" bottom sheet | Tables become stacked cards, dialogs become bottom sheets, inputs use 16 px text (no iOS zoom), ≥ 40–44 px touch targets on touch screens. |
| Tablets (768–1023 px) | Icon rail | Wide tables keep their first column pinned while figures scroll. |
| Desktop (≥ 1024 px) | Full sidebar | — |

- `viewport-fit=cover` + `env(safe-area-inset-*)` keep content clear of notches and the home indicator
  (see the `px-page` / `pb-tabbar` utilities in `src/app/globals.css`).
- Charts: hover with a mouse; on touch, tap or drag sideways to scrub (vertical drags still scroll),
  tap outside to dismiss; keyboard ←/→/Home/End. Every chart has a data-table view.
- Navigation variants are switched with CSS only, so server output is identical for every device.

## Installable app (PWA)

- **Manifest:** `/en/manifest.webmanifest` and `/ar/manifest.webmanifest` (`src/lib/pwa/manifest.ts`) — the
  Arabic one installs an RTL app that opens on `/ar`. Shortcuts: Approvals, Meta Ads, Analytics.
- **Service worker** (`public/sw.js`) is deliberately minimal: it precaches `/offline.html` and shows it
  for navigations while the device is offline. It never caches dashboard pages, data or server actions,
  and doesn't touch requests while online (so Basic Auth and streaming work as usual).
  It is registered only in production builds on HTTPS/localhost.
- **Install UI:** Settings → *App & display* shows an Install button (Chrome/Edge/Android), Share → Add to
  Home Screen steps on iPhone/iPad, or an "already installed" state.
- Manifest, icons, `sw.js` and `offline.html` are outside the Basic Auth matcher (they contain no data).

## Internationalization

- Routes are prefixed (`/en`, `/ar`); `/` redirects using the `NEXT_LOCALE` cookie, then
  `Accept-Language`, then `DEFAULT_LOCALE`.
- Arabic uses IBM Plex Sans Arabic, Latin digits (`ar-u-nu-latn`; change in `src/i18n/config.ts`),
  and mirrored layout via logical CSS properties. Charts keep time flowing left → right.
- Add a string: put it in `en.ts`, then `ar.ts` (TypeScript and a test enforce matching keys and
  placeholders).

## Roadmap to live integrations

Nothing below is done yet. Each step needs real credentials, the right API permissions and review.

1. **Authentication** — real sign-in (e.g. Auth.js/SSO) replacing `src/server/auth/actor.ts`;
   enable `REQUIRE_SEPARATE_APPROVER`.
2. **Meta Ads (read)** — a `LiveMetaAdsService` implementing `MetaAdsService` via the Marketing API
   (`ads_read`), with rate-limit handling and caching; select it in `integrations/registry.ts`.
3. **Shopify (read)** — Admin GraphQL API adapter with read scopes; webhooks for orders.
4. **Higgsfield** — generation jobs, polling/webhooks, asset storage.
5. **Credential storage** — OAuth/token flows that save encrypted tokens in
   `integration_connections` using `encryptSecret()`.
6. **Live execution (writes)** — only after the above: `ads_management` permission, idempotency
   keys, reconciliation for stuck `EXECUTING` requests, then relax the `dryRun: true` type and the
   `SIMULATED`-only DB constraint in a reviewed migration.

## Known limitations

- Mock data only; simulated runs intentionally do not change mock budgets, so automations may
  propose the same change again after a simulation.
- No user authentication or multi-workspace UI (single demo workspace/owner).
- The in-memory store is for demos only (per-process, resets on restart). On serverless hosts such as
  Vercel each instance has its own copy — use PostgreSQL there (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
- Offline support is limited to an offline notice: dashboard data is never cached, so nothing is
  usable without a connection. There are no push notifications.
- Theme follows the device's light/dark setting; there is no in-app theme switch.
- Responsive behaviour is verified in Chromium with phone/tablet/desktop device emulation
  (`npm run test:responsive`); it has not been run on physical iPhones/Android devices or in
  WebKit/Firefox engines by the automated tests.

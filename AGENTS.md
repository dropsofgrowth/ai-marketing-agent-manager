<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules (AI Marketing & E-commerce Agent)

### Safety invariants — do not weaken without an explicit, reviewed decision

- **No live side effects without human approval.** Any change to ads, budgets, products, prices,
  inventory or published creatives must be filed as an `ApprovalRequest`, approved by a person,
  and executed by a separate explicit action.
- **Approval never executes.** `approve()` only records a decision. Execution is `execute()`,
  which claims the request (`APPROVED → EXECUTING`) before calling any adapter.
- **Automations only propose.** They create `PENDING` requests and are clamped to the same
  guardrails as manual requests (`src/domain/automations/rules.ts`).
- **Phase 1 is dry-run only.** `MutationOptions.dryRun` is typed as the literal `true`, mock
  adapters refuse anything else, and a DB check constraint only allows `execution_mode = SIMULATED`.
  Do not change these until live adapters exist, are reviewed, and credentials/permissions are configured.
- **Never claim a live integration works** unless it has been exercised against the real API.
- **Shopify is read-only.** Only GraphQL `query` documents may be sent (`assertReadOnlyDocument` in
  `src/integrations/shopify/graphql-client.ts`); a token with any `write_*` scope is refused and never
  stored. Adding mutations or write scopes needs an explicit, reviewed decision.
- **Third-party tokens are stored only encrypted** (`integration_connections`, AES-256-GCM, a DB CHECK
  rejects non-ciphertext) and refreshed under a row lock — refresh tokens rotate. Log integration events
  only through `src/server/logging.ts` (codes and ids, never tokens, secrets, codes or response bodies).
- **Once a store is connected, failures show an error state — never demo data.** Demo data is only for
  the not-connected state and is always labelled (`<DataSources>`). Never combine live store revenue with
  demo ad spend (see `comparable` in `src/server/queries/performance.ts`).
- **Dashboard access fails closed.** In production `DASHBOARD_BASIC_AUTH_USER/_PASSWORD` are mandatory
  (validated in `src/lib/basic-auth.ts`; missing/invalid → 503 everywhere), and live store data requires
  them in every environment. They are checked in `src/proxy.ts` AND server-side in `getCurrentActor()` —
  never read workspace or store data without going through `getCurrentActor()` (or
  `requireDashboardAccess()`), and never add a bypass/opt-out. `npm run test:auth-gate` guards this.
- **Secrets stay server-side.** Read env only via `src/server/env.ts`; never prefix secrets with
  `NEXT_PUBLIC_`; never log or render credential values (presence only).
- **Server Actions are public endpoints.** Validate input with zod and enforce permissions in the
  service layer (`assertPermission`) — never rely on the proxy or the UI alone.

### Conventions

- Money is integer minor units + ISO currency. Format only via `createFormatter()`.
- All UI strings live in `src/i18n/dictionaries/{en,ar}.ts`; `ar` must match the `en` shape
  (a test checks keys and `{placeholders}`). Wrap user/brand text in `<bdi>` or use `richT()`.
- Use logical Tailwind utilities (`ms-`, `pe-`, `start-`, `text-start`, `rtl:`) so RTL works.
- With Cache Components, request-time data (DB, env-dependent output, `searchParams`) must be read
  inside a `<Suspense>` boundary after `await connection()`.
- Responsive: phones (< md) get the bottom tab bar, tablets the icon rail, desktop the sidebar. A wide
  table needs a phone alternative (`<DataList>`/`<MetricGrid>` from `components/ui/data-list.tsx`, table
  wrapped in `hidden md:block`). Use the `px-page` gutter so content clears notches; inputs stay ≥ 16px on phones.
- PWA: never make `public/sw.js` cache pages, data or Server Action responses. After changing the logo or
  the `offline` strings, run `npm run pwa:assets` (a test fails if `public/offline.html` is stale).
- Run `npm run check` (lint + typecheck + tests) and `npm run build` before committing; for UI changes also
  `npm start` + `npm run test:responsive`.

# Deploying a secure HTTPS preview

This guide gets the dashboard onto an `https://` link you can open on an iPhone, an
Android phone and a Windows or Mac computer, and install as an app (PWA).

> **Mock data by default.** Every option below runs the app with its built-in mock
> adapters. Do **not** add real Meta or Higgsfield credentials, and keep
> `LIVE_EXECUTION_ENABLED=false`; approved changes can only be simulated.
> **Shopify (read-only)** can be connected on a deployment with PostgreSQL, a
> credential encryption key, an https `APP_URL` and Basic Auth — follow
> **[docs/SHOPIFY.md](SHOPIFY.md)**. Use a separate database for preview deployments.

PWA installation and the service worker need **HTTPS** (or `localhost`). All three
options give you HTTPS automatically.

| Option | Best for | Data between requests | Cost |
| --- | --- | --- | --- |
| [A. Vercel](#a-vercel-recommended) | A preview link on every pull request | Needs Postgres for consistent data (see note) | Free (Hobby) |
| [B. Render](#b-render-single-server) | One always-on demo URL | In-memory demo data stays consistent | Free tier (sleeps when idle) |
| [C. Tunnel from your computer](#c-temporary-tunnel-from-your-computer) | A quick test in 5 minutes | Consistent while your computer runs it | Free, no account |

---

## Before you start: protect the preview

There is no user sign-in yet, so anyone with the link could use the dashboard. Turn on
the app's built-in password (HTTP Basic Auth) for every deployment:

```bash
# Pick a username, and generate a long random password:
openssl rand -base64 24
```

| Variable | Value |
| --- | --- |
| `DASHBOARD_BASIC_AUTH_USER` | e.g. `preview` |
| `DASHBOARD_BASIC_AUTH_PASSWORD` | the generated password |
| `LIVE_EXECUTION_ENABLED` | `false` |
| `DEFAULT_LOCALE` | `en` or `ar` |

Leave every `META_*` and `HIGGSFIELD_*` variable **empty**. Add `SHOPIFY_*` only when
you are ready to connect the store (see [docs/SHOPIFY.md](SHOPIFY.md)).

Basic Auth protects every page and server action. The web-app manifest, icons,
`/sw.js`, `/offline.html` and `/api/health` stay public on purpose: browsers fetch
manifests without credentials, and none of these files contain data.

---

## A. Vercel (recommended)

Vercel builds Next.js apps natively and gives **every pull request its own HTTPS
preview URL**, posted as a comment/check on the PR.

1. Sign in at <https://vercel.com> with your GitHub account.
2. **Add New… → Project → Import** `mohmadalodini62-lgtm/ai-marketing-agent`
   (grant the Vercel GitHub app access to the repository if asked).
3. Framework preset: **Next.js** (auto-detected). Keep the default build command
   (`npm run build`) and output settings.
4. **Environment Variables**: add the four variables from the table above. Tick
   **Preview** and **Production** for each.
5. Click **Deploy**.
6. **Settings → General → Node.js Version**: choose **22.x** (the app needs ≥ 20.19).
7. Open the pull request on GitHub: the Vercel check links to the preview, e.g.
   `https://ai-marketing-agent-git-<branch>-<your-team>.vercel.app`. Every new push to
   the branch updates it.

**Deployment Protection.** Vercel's own "Vercel Authentication" on previews is cookie
based and also covers the manifest, which can stop phones from installing the app.
Use the app's Basic Auth (above) instead and set **Settings → Deployment Protection →
Vercel Authentication** to *Disabled* for previews — or leave it on and skip installing.

**Data note (important).** Without `DATABASE_URL` the app uses an in-memory demo store.
Vercel runs the app as serverless functions, so different requests can hit different
instances with different memory: an approval you file may not appear on the next page
load, and data resets often. For a consistent demo add PostgreSQL:

1. Vercel project → **Storage → Create Database → Neon (Postgres)** (free tier), connect
   it to the project. Check **Settings → Environment Variables** that `DATABASE_URL` is
   set for Preview and Production (add it from the Neon connection string if not).
2. From your computer, apply the schema and demo data once:

   ```bash
   DATABASE_URL="<the Neon connection string>" npm run db:deploy
   DATABASE_URL="<the Neon connection string>" npm run db:seed
   ```

3. Redeploy. `https://<preview>/api/health` should report `"storage": {"kind": "postgres", "status": "ok"}`.

CLI alternative (from your computer, after `npm i -g vercel` and `vercel login`):
`vercel` creates a preview deployment, `vercel --prod` a production one. Add env vars
with `vercel env add DASHBOARD_BASIC_AUTH_PASSWORD preview`.

---

## B. Render (single server)

One long-running Node.js server, so the in-memory demo store behaves consistently.

1. <https://dashboard.render.com> → **New → Web Service** → connect the GitHub repo.
2. Runtime **Node**, branch: your PR branch (or `main` after merging).
3. Build command: `npm ci && npm run build` · Start command: `npm start`
4. Environment: the four variables above, plus `NODE_VERSION=22`.
5. Create the service. The URL is `https://<name>.onrender.com`.

The free instance sleeps after ~15 minutes idle; the first request then takes ~30–60 s.
Data in the in-memory store resets on each deploy/restart (add `DATABASE_URL` for
persistence, as in option A).

---

## C. Temporary tunnel from your computer

No account needed. The link works only while your computer keeps running it.

```bash
git clone https://github.com/mohmadalodini62-lgtm/ai-marketing-agent.git
cd ai-marketing-agent
git checkout <the PR branch>        # e.g. claude/ai-marketing-agent-responsive-rmrzia
npm ci
cp .env.example .env                # then set DASHBOARD_BASIC_AUTH_USER / _PASSWORD in .env
npm run build
npm start                           # http://localhost:3000
```

In a second terminal, install and run Cloudflare's quick tunnel:

```bash
# macOS:   brew install cloudflared
# Windows: winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```

It prints a public `https://<random-words>.trycloudflare.com` link. Open it on your
iPhone and computer. **Set the Basic Auth variables first** — the link is public.

---

## Install it as an app

| Device | How |
| --- | --- |
| **iPhone / iPad** (Safari) | Open the link → **Share** → **Add to Home Screen**. (Settings → *App & display* shows the same hint.) |
| **Android** (Chrome) | Menu **⋮ → Install app**, or the install banner, or Settings → *App & display* → **Install**. |
| **Windows / Mac** (Chrome, Edge) | Install icon at the right of the address bar, or menu → **Install Marketing Agent**. |
| **Mac** (Safari 17+) | **File → Add to Dock**. |

Installing from an Arabic page (`/ar`) gives an Arabic, right-to-left app; from `/en`,
an English one. You can switch language inside the app either way.

---

## Check a deployment

```bash
curl https://<your-url>/api/health                       # {"status":"ok",...}
BASE_URL=https://<your-url> BASIC_AUTH=preview:<password> npm run test:responsive
```

The responsive test (first run: `npx playwright install chromium`) loads every page in
English and Arabic on 9 phone/tablet/desktop profiles and checks layout, navigation,
dialogs, charts, the manifest and the service worker.

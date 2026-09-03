# Deploying the AFISZ backend to Railway

This walks you from "nothing on Railway" to "GitHub Pages frontend can read and write folders through the deployed backend."

Time: ~15 minutes. No CLI required.

---

## 0. Prerequisites

- A Railway account (https://railway.com — GitHub sign-in is fine).
- This repo (`angelinakhabner/events_`) on GitHub. Railway needs read access; you'll grant it during the deploy step.
- An Anthropic API key. A Resend API key is **not** required for folder persistence; you only need it once the email module is wired in.

`railway.json` and the monorepo build/start commands are already in the repo, so the deploy should "just work" after the env vars are set.

---

## 1. Create a Railway project

1. https://railway.com/new → **Empty Project**.
2. Name it `goin` (or whatever you like).

---

## 2. Add a Postgres plugin

1. Inside the project, click **+ Create** → **Database** → **PostgreSQL**.
2. Wait ~30s for it to provision.
3. Click the Postgres service → **Variables** tab. Confirm `DATABASE_URL` is set automatically. You don't need to copy it — Railway will inject it into the backend service via a variable reference (next step).

---

## 3. Add the backend service from GitHub

1. **+ Create** → **GitHub Repo** → pick `angelinakhabner/events_`.
2. Railway will start a first build that **will fail** — that's expected because env vars aren't set yet. Cancel it or let it fail; we'll redeploy after configuration.
3. Click the new service → **Settings** tab. Confirm:
   - **Root Directory**: leave **blank** (the monorepo root). Railway needs the root because the build/start commands use `npm --workspace backend`.
   - **Build Command**: leave blank — `railway.json` provides `npm ci && npm --workspace backend run build`.
   - **Start Command**: leave blank — `railway.json` provides `npm --workspace backend run start`. The start script itself chains the migration before `node` so it runs on every deploy and is idempotent (the SQL uses `CREATE TABLE IF NOT EXISTS`).
   - **Healthcheck Path**: `/health` (also from `railway.json`).
   - **Watch Paths**: optionally `backend/**` so frontend-only commits don't trigger a redeploy.

---

## 4. Set environment variables

In the backend service → **Variables** tab → **+ New Variable**, add the following.

| Name | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `${{ Postgres.DATABASE_URL }}` | **Variable reference**, not a literal. Type `${{` and Railway will autocomplete the Postgres service's `DATABASE_URL`. |
| `NODE_ENV` | `production` | |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | Your Anthropic key. Used by the AI parser when scraping lands. |
| `RESEND_API_KEY` | `re_…` | **Required for email sign-in.** Without it the backend mints the login token but only prints the link to the server log — the user never gets an email. |
| `NEWSLETTER_FROM_EMAIL` | `newsletter@afisz.cc` | Optional second sender, used only for newsletter briefs. Unset means briefs go out from `RESEND_FROM_EMAIL`. It must sit on the same verified domain — no extra DNS records are needed for a second address. |
| `RESEND_FROM_EMAIL` | `hello@goin.app` | The sending domain must be verified in Resend (DNS records), otherwise Resend rejects the send and "Continue with email" surfaces the provider error. To try it before owning a domain, use `onboarding@resend.dev`, which only delivers to your own Resend account address. |
| `APP_URL` | `https://afisz.cc` | **Required for email sign-in.** Login emails are built as `<APP_URL>/auth?token=…`. Defaults to `http://localhost:5173`, so if it is unset in production every emailed link points at localhost. Must track the frontend's current domain — a stale value sends users to the old host. No trailing slash needed. |
| `API_PUBLIC_URL` | `https://api.afisz.cc` | Required only for "Sign in with Google". The redirect URI is built as `<API_PUBLIC_URL>/auth/google/callback` and must be registered verbatim in the Google Cloud console, so it changes whenever the API's domain does. |
| `NEWSLETTER_CRON_ENABLED` | `true` | **Required for newsletter briefs.** Unset (the default) means the send sweep never starts — users can subscribe on `/my` and nothing is ever mailed. Also needs `DATABASE_URL` and `RESEND_API_KEY`; on boot the backend logs a `[newsletter]` warning naming whichever is missing. |
| `SCRAPE_CRON_ENABLED` | `true` | Enables the scheduled scrape. Without events in the database, briefs have nothing to report and are skipped as empty. |
| `ADMIN_TOKEN` | long random string | Enables `/admin/*`, including the newsletter diagnostics in §"Newsletter isn't arriving" of [`RUNBOOK.md`](RUNBOOK.md). |
| `INVITE_GATE_ENABLED` | leave unset | The access gate. **Unset or blank keeps the site closed** — only an explicit `false`/`0`/`no`/`off` opens it. Set it to `false` only when the site goes public. See §9. |

Do **not** set `PORT` — Railway injects it automatically and the backend reads it via `process.env.PORT`.

---

## 5. Generate a public domain

1. Backend service → **Settings** → **Networking** → **Generate Domain**.
2. You'll get something like `https://goin-backend-production-XXXX.up.railway.app`. Copy it.
3. Smoke-test: open `https://<your-domain>/health` in a browser — it should return `{"ok":true}`.
4. Also test a tRPC route directly:
   ```bash
   curl https://<your-domain>/trpc/venues.list
   ```
   Should return the seeded Warsaw venues as JSON.

The generated `…up.railway.app` domain keeps working after you add a custom
one, which makes it a useful control: if `api.afisz.cc` is broken but the
Railway domain answers `/health`, the service is fine and the problem is DNS
or the custom-domain binding. Setting `api.afisz.cc` up is two steps — the
Railway side **and** the DNS record — both in [`DOMAINS.md`](DOMAINS.md).

---

## 6. Point the GitHub Pages frontend at Railway

Two repo-side settings:

### a) Set the Pages build variable

https://github.com/angelinakhabner/events_/settings/variables/actions

- **+ New repository variable**
- Name: `VITE_API_URL`
- Value: `https://api.afisz.cc` — or `https://<your-railway-domain>` before the
  custom domain exists (no trailing slash either way)

### b) Redeploy the frontend so the new value is baked into the bundle

Actions → **Deploy frontend** → **Run workflow** → branch `main` → Run.

Wait ~1 minute. The Pages site at `https://afisz.cc/` now talks to Railway instead of itself.

---

## 7. Verify end-to-end

1. Open `https://afisz.cc/my` in a normal browser window and sign in.
2. In the left-hand menu pick **My venues**, then **+ New folder** → type a name → **Create**.
3. The folder appears with its own (empty) section. **No "Unexpected token '<'" error.**
4. Hard-refresh (Cmd/Ctrl+Shift+R). The folder is still there.
5. On a venue row, **+ Add tag** → type a tag → **Add**. It survives a refresh too.
6. Optional: connect to the Railway Postgres from your machine via the Postgres service's **Data** tab → run `SELECT name FROM user_lists;` and `SELECT tags FROM user_venues;` to see the rows.

---

## 8. A staging backend for the dev preview (recommended)

Every push to `dev` publishes a password-gated preview at `https://afisz.cc/dev/`
(`.github/workflows/deploy-frontend.yml`). That build ships the **frontend** from
`dev` — but unless you do this step, it talks to the **production** API, which is
built from the default branch. The preview then reviews half a change.

While `dev` only touches the UI that is harmless. The moment a change on `dev`
alters the API it is not: the newsletter rework (GOI-100/102) split the old
`frequency` field into a send cadence and per-category cadences, so the preview
sent the new shape to a backend still expecting the old one and every **Schedule
newsletter**, **Generate now** and test send came back as a wall of validation
errors naming a field the form no longer had. Nothing was wrong with either
side — they were different versions.

To give `dev` its own backend:

1. In the same Railway project: **+ Create** → **Database** → **Postgres**. The
   staging backend needs its own database. Migrations land on `dev` before the
   default branch, and pointing a `dev` build at the production database would
   apply them to production ahead of the promotion that is supposed to gate them.
2. **+ Create** → **GitHub Repo** → the same repo, configured exactly as in
   step 3 — then **Settings** → **Source** → set the branch to `dev`.
3. Give it the variables from step 4, with:
   - `DATABASE_URL` referencing the **new** Postgres plugin, not production's,
   - `APP_URL` = `https://afisz.cc/dev/`,
   - `API_PUBLIC_URL` = the staging domain from step 5.
   Keep the third-party keys pointed at test credentials where the provider has
   them: this backend sends real email.
4. Generate a public domain for it (step 5) — `api-dev.afisz.cc` if you want it
   under the custom domain, or the `…up.railway.app` one Railway gives you.
5. Add the repo variable `VITE_DEV_API_URL` with that URL:
   https://github.com/angelinakhabner/events_/settings/variables/actions
   The dev build picks it up; production keeps using `VITE_API_URL`, and if
   `VITE_DEV_API_URL` is unset nothing changes.
6. Re-run **Deploy frontend** so the preview bundle is rebuilt with it.

Until that exists, treat the dev preview as reviewing frontend changes only, and
verify anything API-shaped locally (`npm run dev`) before promoting `dev`.

The Newsletter tab now says so itself rather than leaving it to be discovered:
`newsletter.get` answers in the shape its own build has, so when the API
predates the page the tab opens with a banner naming the mismatch — before
either button is pressed — and both buttons' errors end with the same sentence.
The fix is still this section, or the promotion that redeploys the backend.

---

## 9. Invite someone through the access gate

While `INVITE_GATE_ENABLED` is on (the default), every route except `/health`,
`/gate`, `/robots.txt` and `/i/*` answers `401 {"error":"not available"}` — the
frontend included. Access comes from an invite link:

```
https://api.afisz.cc/i/<token>
```

Opening it sets a 90-day httpOnly cookie and redirects to `APP_URL`. The link is
**reusable** — one link per person (or per group) that they can come back
through, not a one-time code.

Invites live in the `invites` table on the Railway Postgres, so minting one
means running `backend/src/scripts/invites.ts` against the production database.
Only the SHA-256 of a token is stored: **the link is printed once and cannot be
recovered.** Lose it and you mint a new one.

### a) From inside the deployed container (preferred)

Nothing leaves Railway, and `DATABASE_URL` / `API_PUBLIC_URL` are already
correct in the service's environment.

```bash
npm i -g @railway/cli          # once
railway login
railway link                   # pick the project, then the backend service
railway ssh -- node dist/backend/src/scripts/invites.js create "kasia"
```

Use the compiled path, not `npm run invites` — that entry point runs through
`tsx`, a devDependency that the production image may not carry. The build
compiles `src/scripts/**` alongside everything else, so
`dist/backend/src/scripts/invites.js` is always there.

The label is for you, not the invitee; it is what `revoke` takes. Add
`--days 30` for an expiring link (default: never expires).

### b) From your machine, against the production database

If `railway ssh` isn't available to you, connect to Postgres over its public
proxy. In the Railway dashboard: Postgres service → **Variables** →
`DATABASE_PUBLIC_URL`. The plain `DATABASE_URL` is the private-network host
(`postgres.railway.internal`) and does **not** resolve outside Railway.

```bash
DATABASE_URL='<DATABASE_PUBLIC_URL>' API_PUBLIC_URL='https://api.afisz.cc' \
  npm --workspace backend run invites -- create "kasia"
```

`API_PUBLIC_URL` is not optional here: the script builds the link from it, and
without it you get `http://localhost:3001/i/…`, which is useless to the
invitee. It must be the API's origin — the `/i/<token>` route is served by the
backend, and it is the response to *that* request that sets the cookie.

### c) Managing what you've handed out

```bash
railway ssh -- node dist/backend/src/scripts/invites.js list
railway ssh -- node dist/backend/src/scripts/invites.js revoke kasia
```

`list` shows label, status, use count, last use, expiry, and an 8-character id
(never the token). `revoke` takes a label or that id prefix, and takes effect on
the invitee's next request — the cookie carries the token itself and is
re-checked against the table every time, so there is no window where a revoked
link keeps working.

### Before you send the link

- **Send it privately** (DM, signal, email — not an issue, PR, or public
  channel). Anyone holding the URL is in; there is no per-person identity
  behind it. Railway's own edge logs see the path, which is why the link is
  shared privately rather than treated as a secret the platform protects.
- The cookie is `SameSite=None; Secure` because the SPA (GitHub Pages) and the
  API (Railway) are different origins. Both ends must be HTTPS, so the link you
  send must be the `api.afisz.cc` (or `…up.railway.app`) origin.
- Ask them to open it in the browser they'll actually use — the cookie is
  per-browser, and it's the gate, not a login.

---

## Troubleshooting

### `Unexpected token '<', "<html>..." is not valid JSON` in the modal alert

The frontend is hitting an origin that doesn't have the backend. Two causes:

- `VITE_API_URL` not set → the frontend POSTs to its own origin → GitHub Pages returns `index.html` → JSON parse fails. **Set the variable and re-run the Deploy frontend workflow** (the value is build-time, not runtime — a redeploy is required).
- `VITE_API_URL` set to a stale Railway URL. Check that the URL works in `/health`.

### Requests to the API fail with `ERR_NAME_NOT_RESOLVED`

`VITE_API_URL` points at a hostname that does not exist in DNS — typically a
custom domain added on the Railway side only. Registering `api.<domain>` under
**Settings → Networking → Custom Domain** tells Railway to answer for that
`Host`; it does not create the record. Add the `CNAME` at your DNS host too —
see [`DOMAINS.md`](DOMAINS.md).

### Deploy logs show `DATABASE_URL is required to run migrations`

The variable reference didn't resolve. In the backend service's Variables tab, the value next to `DATABASE_URL` should show the resolved Postgres URL — if it shows the literal `${{ Postgres.DATABASE_URL }}` string, click it and re-pick the reference.

### Deploy logs show `CORS` or `Origin not allowed`

Not currently possible — the backend uses `cors({ origin: '*' })`. If you tighten that later, allowlist `https://afisz.cc` (and `https://<owner>.github.io` if the Pages default URL is still in use).

### Pages site loads but every request hangs

Railway service may have spun down on the free tier. First request can take ~10s while it cold-starts. Subsequent requests are fast.

### An invited person sees "Not available." or a blank 401

Walk it in this order:

- **The link was mistyped or truncated.** A token is exactly 43 base64url
  characters; anything else is rejected before it reaches the database, and
  every failure returns the same page on purpose. Chat clients that linkify
  aggressively are the usual culprit — re-send it in backticks.
- **It was revoked or expired.** `invites list` shows the row's status.
- **They opened it, then went to the site in a different browser or profile**
  (or a private window that has since closed). The cookie is per-browser.
- **Their browser blocks third-party cookies.** The gate cookie is set by
  `api.afisz.cc` while the app runs on `afisz.cc` / GitHub Pages, so a strict
  blocker drops it. Mint nothing new — this is a browser setting, not a bad
  link.
- **The whole site is 401, for you too.** Then it is the gate itself: check
  `INVITE_GATE_ENABLED` in the backend service. Blank counts as "on".

`GET /gate` on the API answers `{"open":true|false}` for the calling browser
and is the fastest way to tell "cookie missing" from "link bad".

### Migration runs but tables don't appear in the Data tab

Refresh the Data tab. If still missing, check the deploy logs for "applied 0000_init.sql". If you see "DATABASE_URL is required", see above.

---

## What this didn't cover
- Tightening CORS to just `https://afisz.cc`.
- Locking down direct access to the backend (no auth yet — anyone with the Railway URL can hit the API). Fine for MVP; revisit when auth lands.
- A Railway **release phase** for migrations as a separate step. Today, migrations run as part of the start command. That works because the SQL is idempotent.

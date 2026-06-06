# Deploying the Goin backend to Railway

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
| `RESEND_API_KEY` | `re_…` | Optional today, but the config schema accepts it. |
| `RESEND_FROM_EMAIL` | `hello@goin.app` | Default is fine for now. |

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

---

## 6. Point the GitHub Pages frontend at Railway

Two repo-side settings:

### a) Set the Pages build variable

https://github.com/angelinakhabner/events_/settings/variables/actions

- **+ New repository variable**
- Name: `VITE_API_URL`
- Value: `https://<your-railway-domain>` (no trailing slash)

### b) Redeploy the frontend so the new value is baked into the bundle

Actions → **Deploy frontend** → **Run workflow** → branch `main` → Run.

Wait ~1 minute. The Pages site at `https://angelinakhabner.github.io/events_/` now talks to Railway instead of itself.

---

## 7. Verify end-to-end

1. Open `https://angelinakhabner.github.io/events_/my` in a normal browser window.
2. Click **New folder** → type a name → **Create folder**.
3. Modal closes, folder appears in the list. **No "Unexpected token '<'" error.**
4. Hard-refresh (Cmd/Ctrl+Shift+R). Folder is still there.
5. Open the same URL in an incognito window. The list is empty (different `goin_device_id` in `localStorage` → different folder owner).
6. Optional: connect to the Railway Postgres from your machine via the Postgres service's **Data** tab → run `SELECT * FROM folders;` to see the row.

---

## Troubleshooting

### `Unexpected token '<', "<html>..." is not valid JSON` in the modal alert

The frontend is hitting an origin that doesn't have the backend. Two causes:

- `VITE_API_URL` not set → the frontend POSTs to its own origin → GitHub Pages returns `index.html` → JSON parse fails. **Set the variable and re-run the Deploy frontend workflow** (the value is build-time, not runtime — a redeploy is required).
- `VITE_API_URL` set to a stale Railway URL. Check that the URL works in `/health`.

### Deploy logs show `DATABASE_URL is required to run migrations`

The variable reference didn't resolve. In the backend service's Variables tab, the value next to `DATABASE_URL` should show the resolved Postgres URL — if it shows the literal `${{ Postgres.DATABASE_URL }}` string, click it and re-pick the reference.

### Deploy logs show `CORS` or `Origin not allowed`

Not currently possible — the backend uses `cors({ origin: '*' })`. If you tighten that later, allowlist `https://<owner>.github.io`.

### Pages site loads but every request hangs

Railway service may have spun down on the free tier. First request can take ~10s while it cold-starts. Subsequent requests are fast.

### Migration runs but tables don't appear in the Data tab

Refresh the Data tab. If still missing, check the deploy logs for "applied 0000_init.sql". If you see "DATABASE_URL is required", see above.

---

## What this didn't cover

- Custom domain on Pages or Railway.
- Tightening CORS to just `https://angelinakhabner.github.io`.
- Locking down direct access to the backend (no auth yet — anyone with the Railway URL can hit the API). Fine for MVP; revisit when auth lands.
- A Railway **release phase** for migrations as a separate step. Today, migrations run as part of the start command. That works because the SQL is idempotent.

# Goin

A customisable cultural events aggregator. Add any venue URL from any city,
group venues into folders with persistent filters (category, time, price,
day, city), and let an LLM extract structured events from venue pages.

## Stack

- **Backend:** Node.js + TypeScript + Hono + tRPC + Drizzle (Postgres)
- **Frontend:** React + Vite + TypeScript + @tanstack/react-query
- **DB & hosting:** Railway (Postgres + backend)
- **AI:** Anthropic Claude for parsing event listings
- **Email:** Resend (transactional)
- **CI:** GitHub Actions
- **Tests:** Vitest everywhere, React Testing Library on the frontend

## Layout

```
backend/    Hono server, tRPC router, scraping / AI / cache / email services
frontend/   Vite + React app, tRPC client, pages, components
shared/     Shared TypeScript types (Venue, Event, Folder, EventFilters)
```

## Setup

```bash
npm install
cp .env.example .env       # fill in DATABASE_URL, ANTHROPIC_API_KEY, RESEND_API_KEY
docker compose up -d       # local Postgres on :5432 (user/pass/db: goin)
npm run db:migrate         # create the folders + venues tables
```

`DATABASE_URL` for local dev: `postgresql://goin:goin@localhost:5432/goin`.
Folders persist to Postgres when this is set; without it, the backend falls
back to an in-memory store (handy for fast unit tests).

Database scripts:

```bash
npm run db:migrate         # apply backend/drizzle/*.sql
npm run db:reset           # drop tables and re-apply
npm run db:studio          # drizzle-kit studio
```

## Run

```bash
npm run dev                # backend on :3001, frontend on :5173
npm run dev:backend
npm run dev:frontend
```

## Test

```bash
npm test                   # all tests
npm run test:backend       # vitest run in backend
npm run test:frontend      # vitest run in frontend (jsdom)
npm --workspace backend run test:integration
```

Write tests next to the module under test (`foo.ts` ↔ `foo.test.ts`).
Integration tests live in `backend/src/__tests__/integration/`.

## Type check & lint

```bash
npm run typecheck
npm run lint
```

## Environment variables

| Variable | Local value | Railway value | Purpose |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` | Runtime mode |
| `PORT` | `3001` | injected by Railway | Backend HTTP port (server binds `0.0.0.0`) |
| `DATABASE_URL` | `postgresql://goin:goin@localhost:5432/goin` | `${{ Postgres.DATABASE_URL }}` | Postgres connection. Unset ⇒ in-memory folder store |
| `ANTHROPIC_API_KEY` | `sk-ant-…` (optional locally) | `sk-ant-…` | Claude API key for AI event parsing |
| `RESEND_API_KEY` | `re_…` (optional locally) | `re_…` | Resend key for transactional email |
| `RESEND_FROM_EMAIL` | `hello@goin.app` | `hello@goin.app` | From-address for outbound email. The domain must be verified in Resend |
| `APP_URL` | `http://localhost:5173` | `https://<owner>.github.io/<repo>` | Public frontend origin. Magic-link emails link to `<APP_URL>/auth?token=…` |
| `NEWSLETTER_CRON_ENABLED` | unset | `true` | **Required for newsletter briefs to go out at all.** Unset ⇒ the send sweep never starts and no brief is ever mailed, however subscriptions are configured |
| `ADMIN_TOKEN` | unset (optional) | a long random string | Enables the `/admin/*` debug endpoints, including the newsletter diagnostics below. Callers pass `?token=<value>` |
| `VITE_API_URL` | empty (Vite proxies `/trpc` → :3001) | set as a **GitHub Actions repo variable**, baked into the Pages build | Backend base URL the frontend calls |
| `VITE_BASE_PATH` | falls back to `/events_/` | workflow passes `/<repo>/` | Vite `base` for the GitHub Pages subpath |

`ANTHROPIC_API_KEY` and `RESEND_API_KEY` are read lazily — the server boots and
serves venues/folders/default events without them; only AI parsing and email
calls fail if they're missing. In particular, **email sign-in silently does
nothing useful without `RESEND_API_KEY`**: the token is still minted, but the
link is only written to the server log and the UI says email isn't configured. CI uses a throwaway set (`backend/.env.test`)
against the CI Postgres service.

## Scheduled scraping (not yet wired)

There is **no cron / scheduled scrape today.** `services/scraper.ts` (fetch) and
`services/ai-parser.ts` (Claude parse) exist but are not yet orchestrated or
persisted — Home serves a deterministic default event set
(`data/default-events.ts`). Wiring fetch → parse → persist on a schedule is the
next milestone; see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Architecture notes

- `VenueStore` is an in-memory implementation behind a small interface so
  the API works without a database. Swap for a Drizzle-backed store when
  `DATABASE_URL` is provisioned.
- The default venue set (`backend/src/data/default-venues.ts`) seeds
  Warsaw for v1 but the data model is global — `getVenues({ city, country, category })`
  filters whatever is in the store.
- AI parsing is isolated in `services/ai-parser.ts` so the prompt and
  schema can evolve without touching scraping or caching.
- `TTLCache` provides the 2h cache contract today; a Postgres-backed
  implementation can plug in by matching the same interface.
- No auth in MVP. The `folders.userId` column and `MyPage` route exist
  so auth slots in without reshaping the data model.

## Branch workflow: dev → main

The default branch (`claude/epic-goldberg-qj4EC`) is production. All updates
go through the `dev` branch first:

1. Develop on a feature branch, merge/PR into `dev`.
2. CI runs the full suite (typecheck, lint, unit + integration tests) on
   every push to `dev`.
3. Each push to `dev` also redeploys a **password-gated dev preview** at
   `https://<owner>.github.io/<repo>/dev/` — check your updates there. The
   password's SHA-256 hash is baked into the dev build
   (`VITE_DEV_GATE_HASH` in `.github/workflows/deploy-frontend.yml`); the
   password itself is shared privately. The unlock persists per browser via
   `localStorage`. Note this is a client-side deterrent for a public static
   preview, not real security.
4. Once verified, open a PR `dev` → default branch. Merging redeploys the
   production site at the Pages root (no gate there).

To rotate the dev password: `printf '%s' 'new-password' | sha256sum` and put
the digest in `DEV_GATE_HASH` in `deploy-frontend.yml`.

## Deploying the frontend to GitHub Pages

The workflow at `.github/workflows/deploy-frontend.yml` runs after CI passes
on `main`, builds `frontend/`, and deploys `dist/` to GitHub Pages via the
official `actions/configure-pages` → `actions/upload-pages-artifact` →
`actions/deploy-pages` pipeline.

One-time setup in the repo:

1. **Settings → Pages →** *Source: **GitHub Actions***.
2. **Settings → Secrets and variables → Actions → Variables → New variable**
   `VITE_API_URL` = the Railway backend URL (e.g. `https://goin-backend.up.railway.app`).
3. Push to `main`. Once `CI` goes green, `Deploy frontend` runs and the site
   appears at `https://<owner>.github.io/<repo>/`. You can also trigger it
   manually from **Actions → Deploy frontend → Run workflow**.

The Vite `base` is set from `VITE_BASE_PATH` (the workflow passes
`/<repo>/`); locally it falls back to `/events_/`. In dev, the Vite proxy
forwards `/trpc` to `http://localhost:3001`, so `VITE_API_URL` can stay
empty in `.env`. In production it must be the Railway URL.

## Scraping pipeline

One scheduled scrape per day pulls each venue's repertoire, extracts events
with Claude Sonnet 4.6, and upserts them into Postgres. The frontend reads
from the DB on every request — refreshing the page slides the time window
forward without re-scraping.

### Local

```bash
npm --workspace backend run db:seed         # idempotent: inserts default venues
npm --workspace backend run scrape:one muranow   # force-scrape one venue (real API)
npm --workspace backend run scrape:all:dev       # scrape all venues
```

### Scheduling on Railway (no cron required)

Railway's cron feature isn't available on all plans, so the scheduled
scrape runs **inside the backend server process** via an in-process
scheduler (`backend/src/services/scheduler.ts`). Enable it with env vars on
the backend service:

| Variable | Value | Meaning |
|---|---|---|
| `SCRAPE_CRON_ENABLED` | `true` | turn the scheduler on (off by default so dev/test servers don't scrape) |
| `SCRAPE_CRON_HOUR` | `7` (default) | hour of day in **Europe/Warsaw** to run |
| `SCRAPE_CRON_DAY_OF_WEEK` | unset (default) | day of week in **Europe/Warsaw** to run (`0`=Sun … `6`=Sat). Unset → daily; set to e.g. `1` for a weekly Monday sweep |
| `SCRAPE_BATCH_ENABLED` | `true` (default) | send the sweep's LLM extractions through Anthropic's Message Batches API at **half the per-token price**. Set `false` for the sequential, one-request-per-venue path |
| `SCRAPE_BATCH_CONCURRENCY` | `3` (default) | parallel venue fetches during a batched sweep. Venues waiting on the batch don't hold a slot, so this only paces Firecrawl renders |

**Halving token cost with the Batch API:** every venue that needs the LLM
has its prompt collected rather than sent, and the whole sweep goes out as a
single batch — billed at 50% of standard rates. Batch requests also don't
draw on the per-minute rate limits, which is why the batched path doesn't
need the `SCRAPE_VENUE_GAP_MS` pause between venues. The tradeoff is
latency: results usually land within the hour, but the API's guarantee is 24
hours, so a sweep can take longer to complete than the sequential path.
Deterministic venues, unchanged pages, and JSON-LD venues never call the
model, so they're unaffected either way.

A batch that hasn't finished within 6 hours is cancelled and its venues are
recorded as failed, so the next sweep retries them from scratch. If the
process restarts mid-batch the in-flight results are lost (and still
billed) — a once-a-day risk worth knowing about, not currently mitigated.

**Saving tokens with a weekly cadence:** most venues publish their
schedules weeks or months ahead, so a daily sweep mostly re-bills Anthropic
tokens for listings that haven't changed. Setting `SCRAPE_CRON_DAY_OF_WEEK`
(e.g. `1` for Monday) drops the scrape to once a week, cutting that cost
roughly 7× while still catching new events well before they happen. Leave
it unset to keep the original daily behaviour.

On boot the server logs `[scheduler] next scrape in X.Xh (daily …)` or
`(weekly on Monday …)`, fires at the configured time, then re-arms for the
next occurrence. DST is handled — the target is computed against the
Europe/Warsaw wall clock, not UTC.

`scrape:all` is still available as a CLI (`npm --workspace backend run
scrape:all`) if you later move to Railway cron or any external scheduler —
in that case set `SCRAPE_CRON_ENABLED=false` to avoid double scraping.

Failures are recorded in the `scrape_runs` table; tail Railway logs for
live output.

### Manual smoke test

After deploy, exercise the live pipeline:

```bash
npm --workspace backend run scrape:one muranow
```

This hits the real Muranów page and the real Claude API. Inspect the
resulting `scrape_runs` row and the new `events` rows.

## Deploying the backend to Railway

See **[`docs/RAILWAY.md`](docs/RAILWAY.md)** for the step-by-step (Postgres
plugin, env vars, public domain, wiring the Pages frontend, verification,
and troubleshooting).

Short version:
1. New Railway project → add Postgres plugin.
2. Deploy this repo as a service — `railway.json` already pins the build
   (`npm ci && npm --workspace backend run build`) and start
   (`npm --workspace backend run start`, which itself chains the migration)
   commands and `/health` as the healthcheck.
3. Env vars: `DATABASE_URL=${{ Postgres.DATABASE_URL }}`, `ANTHROPIC_API_KEY`,
   `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_URL`, `NODE_ENV=production`.
4. Generate a public domain → set `VITE_API_URL` (repo Actions variable) to it
   → re-run the **Deploy frontend** workflow.

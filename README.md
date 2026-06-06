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
   `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NODE_ENV=production`.
4. Generate a public domain → set `VITE_API_URL` (repo Actions variable) to it
   → re-run the **Deploy frontend** workflow.

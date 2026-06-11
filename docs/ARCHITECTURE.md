# Architecture

Goin is a customisable cultural-events aggregator: browse a curated default set
of events, add your own venue URLs, and group venues into folders with
persistent filters. This document describes how the pieces fit together **as
built today**, and flags the parts that are scaffolded but not yet wired.

## System overview

```
                         GitHub Pages (static)
   ┌───────────────────────────────────────────────┐
   │  React + Vite SPA  (frontend/)                 │
   │   pages: Home, MyFolders                       │
   │   tRPC client (@trpc/react-query)              │
   └───────────────┬───────────────────────────────┘
                   │  HTTPS, tRPC over /trpc/*  (VITE_API_URL)
                   ▼
        Railway service (backend/)
   ┌───────────────────────────────────────────────┐
   │  Hono HTTP server  (app.ts, binds 0.0.0.0)     │
   │   /health                                      │
   │   /trpc/*  → appRouter (venues, events, folders)│
   │                                                │
   │   services/                                    │
   │     venue-store   (in-memory seed)             │
   │     folder-store  (Postgres OR in-memory)      │
   │     filters       (matchesEvent / filterEvents)│
   │     cache         (TTLCache, 2h)               │
   │     email         (Resend)                     │
   │     scraper ───────┐  ai-parser ───────┐  *not yet wired*
   └────────┬───────────┼───────────────────┼──────┘
            │           │ fetch venue HTML  │ parse HTML → events
            ▼           ▼                   ▼
     Postgres       venue websites    Anthropic Claude API
   (Railway plugin)   (public web)      (messages API)
```

Solid path (frontend → tRPC → Hono → Postgres) is live. The
`scraper`/`ai-parser` → Claude path exists in code but nothing calls it on a
schedule and nothing persists its output yet (see [Scraping](#scraping-status)).

## Components

- **frontend/** — React + Vite SPA, deployed as static files to GitHub Pages.
  Talks to the backend only through the tRPC client (`lib/trpc.ts`). Two pages:
  `Home` (default events + filter bar) and `MyFolders` (per-device folders).
  Device identity is a random id in `localStorage` (`lib/device-id.ts`), sent as
  the `x-device-id` header — there is no login.
- **backend/** — Hono server exposing one health route and the tRPC router
  (`trpc/router.ts`). Procedures: `venues.*`, `events.listDefault`, `folders.*`.
  `deviceProcedure` enforces the `x-device-id` header for folder operations.
- **shared/** — the cross-package TypeScript types (`Venue`, `Event`, `Folder`,
  `EventFilters`). Both frontend and backend import `@goin/shared`.
- **Postgres** — Drizzle schema in `db/schema.ts`, raw SQL migrations in
  `backend/drizzle/*.sql`, applied by `db/migrate.ts` (also runs on Railway boot
  via the `start` script).

## Data model

Two tables exist today (`backend/drizzle/0000_init.sql`):

- **`venues`** — `id, name, url (unique), city, country, category, language,
  created_at`. *Note:* although the table exists, the running API serves venues
  from an **in-memory seed** (`data/default-venues.ts`); the DB-backed venue
  store is intended but not the default path yet.
- **`folders`** — `id, device_id (indexed), name, filters (jsonb), venue_ids
  (text[]), created_at, updated_at`. This is the one table actively read/written
  in production, via `DbFolderStore` (used when `DATABASE_URL` is set).

Planned but **not yet created** (needed for real scraping):

- **`events`** — persisted scraped events (title, starts_at, venue_id,
  source_url, source_id, timezone, price, …). Today events are generated
  in-memory by `data/default-events.ts`.
- **`scrape_runs`** — one row per venue scrape attempt (status, events_found,
  error_message, content hash for skip-unchanged, token usage/cost). Does not
  exist yet; cost tracking and the scrape pipeline depend on it.

## Key flows

### User creates a folder

```
Frontend (MyFolders / NewFolderModal)
  → trpc.folders.create({ name, venueIds, filters })   [x-device-id header]
  → deviceProcedure asserts header present
  → folder-store.create()  →  INSERT into folders (DbFolderStore)
                              or Map.set (InMemoryFolderStore if no DATABASE_URL)
  → returns Folder; react-query invalidates folders.listMine
```
Folders are partitioned by `device_id`; cross-device update/delete is rejected
with `UNAUTHORIZED` (enforced in both stores + mapped in the router).

### Daily scrape (target design — not yet wired)

```
(scheduler)  → for each venue:
  scraper.scrapeVenue(url)        fetch raw HTML
  → preprocess/trim HTML          (today: ai-parser slices to 80k chars)
  → ai-parser.parseEventsFromHtml → Claude messages API → JSON events
  → validate (zod ParsedEvent)    → drop invalid entries
  → persist events + write scrape_runs row (status, counts, token cost)
  → hash venue HTML; skip Claude next run if unchanged   ← cost saver
```
Implemented today: `scrapeVenue` (bare fetch) and `parseEventsFromHtml` (Claude
call + zod validation, throws on any invalid entry). **Missing:** orchestration,
persistence, `scrape_runs`, content-hash skip, graceful per-entry degradation,
token/cost capture, and a scheduler.

### User loads Home page

```
Frontend Home
  → trpc.events.listDefault({ filters })   and   trpc.venues.list()
  → router: generateDefaultEvents()  (deterministic mock set)
  → filterEvents(events, venueMap, filters)   server-side filtering
  → returns Event[]; EventList groups by calendar day, renders EventCards
```
Filtering already runs on the backend (`services/filters.ts`). Events are mock
data; swapping `generateDefaultEvents()` for a DB query is the integration point
once the `events` table lands.

## Deploy topology

```
  GitHub (main)
     │  push / merge
     ├──► GitHub Actions: CI  (lint, typecheck, unit+integration vs CI Postgres)
     │        │ on success, on main
     │        └──► Deploy frontend workflow ─► GitHub Pages (static SPA)
     │
     └──► Railway (watches repo): build backend ─► run migrations ─► start Hono
              │
              └── Railway Postgres plugin  (DATABASE_URL)
```

- **Frontend:** `.github/workflows/deploy-frontend.yml` runs after CI passes on
  `main`, builds `frontend/` with `VITE_API_URL`/`VITE_BASE_PATH`, and publishes
  `dist/` to GitHub Pages.
- **Backend:** Railway builds via `railway.json`
  (`npm --workspace backend run build`) and starts with
  `npm --workspace backend run start`, which runs migrations then boots the
  server; `/health` is the healthcheck. See [`RAILWAY.md`](RAILWAY.md).
- **Database:** Railway Postgres plugin; `DATABASE_URL` injected into the
  backend service.
- **Cron:** none configured yet. The scheduled scrape in the flow above is the
  next milestone.

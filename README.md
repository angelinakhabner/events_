# AFISZ

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
| `EXTRACTOR_MODEL` | `claude-sonnet-4-6` | `claude-sonnet-4-6` | Extraction model. Override to trial a candidate without a deploy |
| `EXTRACTOR_MODEL_STRUCTURED` | unset | unset | Model used **only** for pages whose input is structured data (JSON-LD / `__NEXT_DATA__`) rather than HTML — see [Choosing an extraction model](#choosing-an-extraction-model). Unset ⇒ `EXTRACTOR_MODEL` |
| `VENUE_SUGGEST_MODEL` | `claude-sonnet-4-6` | `claude-sonnet-4-6` | Model behind ["propose similar venues"](#proposing-similar-venues-goi-86). Separate from `EXTRACTOR_MODEL`: that one transcribes HTML, this one needs world knowledge about real venues |
| `RESEND_API_KEY` | `re_…` (optional locally) | `re_…` | Resend key for transactional email |
| `RESEND_FROM_EMAIL` | `hello@goin.app` | `hello@afisz.cc` | From-address for transactional email (sign-in links, welcome mail). The domain must be verified in Resend |
| `NEWSLETTER_FROM_EMAIL` | unset | `newsletter@afisz.cc` | From-address for newsletter briefs. Unset ⇒ falls back to `RESEND_FROM_EMAIL`. Same verified domain, so a second address needs no extra DNS |
| `APP_URL` | `http://localhost:5173` | `https://afisz.cc` | Public frontend origin. Magic-link emails link to `<APP_URL>/auth?token=…` |
| `API_PUBLIC_URL` | unset | `https://api.afisz.cc` | Public backend origin. Builds the Google OAuth redirect URI `<API_PUBLIC_URL>/auth/google/callback`, which must be registered verbatim in the Google console |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | unset (optional) | from the Google console | Google sign-in **and** ["save briefs to a drive"](#saving-briefs-to-a-drive-goi-91). Unset ⇒ both features report themselves unavailable rather than failing |
| `NEWSLETTER_CRON_ENABLED` | unset | `true` | **Required for newsletter briefs to go out at all.** Unset ⇒ the send sweep never starts and no brief is ever mailed, however subscriptions are configured |
| `ADMIN_TOKEN` | unset (optional) | a long random string | Enables the `/admin/*` debug endpoints, including the newsletter diagnostics below. Callers pass `?token=<value>` |
| `NEWSLETTER_API_KEY` | unset (optional) | a long random string | Enables the [public newsletter API](#public-newsletter-api-goi-87). Unset ⇒ every `/api/v1/newsletter/*` route answers 503. Keep it distinct from `ADMIN_TOKEN`: this one is handed to third parties |
| `VITE_API_URL` | empty (Vite proxies `/trpc` → :3001) | `https://api.afisz.cc`, set as a **GitHub Actions repo variable** and baked into the Pages build | Backend base URL the frontend calls |
| `VITE_BASE_PATH` | falls back to `/events_/` | workflow passes `/` (`/dev/` for the preview) | Vite `base`. The site is served from the `afisz.cc` apex, not the `/<repo>/` Pages subpath |

`ANTHROPIC_API_KEY` and `RESEND_API_KEY` are read lazily — the server boots and
serves venues/folders/default events without them; only AI parsing and email
calls fail if they're missing. In particular, **email sign-in silently does
nothing useful without `RESEND_API_KEY`**: the token is still minted, but the
link is only written to the server log and the UI says email isn't configured. CI uses a throwaway set (`backend/.env.test`)
against the CI Postgres service.

## The public landing page

`/` serves a real, crawlable page — what AFISZ.KA is, how to ask for an
invitation, a contact address and the privacy policy — rather than the app or a
redirect to it. The app itself stays behind the invite gate; the landing page is
what everyone else gets.

It is **static HTML baked into `index.html` at build time**, not a React route.
A crawler handed an empty `#root` and a bundle to run may never see a word of a
gated SPA, so the page is complete in the served document: no JavaScript, no API
call, no webfont, nothing fetched from anywhere. That last part is why its own
privacy policy can say so.

| File | What it is |
|---|---|
| `frontend/src/landing/content.ts` | All the copy — name, description, invitation note, contact, policy. The only place it lives. |
| `frontend/src/landing/render.ts` | Renders that copy to HTML, plus the inline stylesheet and the `<head>` tags (title, description, canonical, Open Graph, JSON-LD). |
| `frontend/vite.config.ts` | The `afisz-landing` plugin, which substitutes the result into the `<!--afisz:head-->` and `<!--afisz:landing-->` markers in `index.html`. A missing marker fails the build. |
| `frontend/src/lib/landing.ts` | Shows and hides the page in the browser. React never renders it — it can only draw the curtain. |
| `frontend/public/robots.txt` | Allows `/`, disallows the `/dev/` preview (which builds the same markup with `noindex`). |

To change the copy, edit `content.ts` and nothing else. `src/landing/render.test.ts`
asserts that everything the page promises to carry is in the served markup.

## Public newsletter API (GOI-87)

A REST/JSON surface so **other services** can work with the newsletter —
a signup form on another site, a CRM syncing its list, an external scheduler
driving sends. The SPA's tRPC procedures need a browser session and are not
usable from outside; this is.

Enable it by setting `NEWSLETTER_API_KEY` to a long random string. While it is
unset every route answers `503`, so a deploy that forgets to configure one
exposes nothing. Authenticate with `Authorization: Bearer <NEWSLETTER_API_KEY>`.

The API sits **above the invite gate** — the services it exists for hold no
invite cookie — and carries its own bearer auth instead. Subscriptions are
addressed by **email**, never by internal user id.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/newsletter/status` | Whether this deployment can actually deliver (cron flag, DB, Resend). Start here — it separates "my key is wrong" from "this environment sends no email" |
| `GET` | `/api/v1/newsletter/subscriptions` | Every enabled subscription |
| `GET` | `/api/v1/newsletter/subscriptions/:email` | One subscription; `404` if the address has none |
| `POST` | `/api/v1/newsletter/subscriptions` | Create or replace one. An address with no account gets one — this is what makes an external signup form work. It mints no session, so the caller gains no way to act *as* that user |
| `DELETE` | `/api/v1/newsletter/subscriptions/:email` | Unsubscribe. **Disables rather than deletes**, so a resubscribe isn't a fresh setup and the send history survives |
| `POST` | `/api/v1/newsletter/send` | Run a send sweep now. Body: `{ "dryRun": true, "force": true, "only": "ada@example.com" }`, all optional |

```bash
API=https://api.afisz.cc/api/v1/newsletter
KEY=$NEWSLETTER_API_KEY

# Can this deployment deliver at all?
curl -s -H "Authorization: Bearer $KEY" "$API/status"

# Subscribe someone: only email and frequency are required, everything
# else takes the same defaults the app's own form uses.
curl -s -X POST -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","frequency":"daily","sendHour":8}' "$API/subscriptions"

# What would go out right now, without sending anything:
curl -s -X POST -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"dryRun":true}' "$API/send"

curl -s -X DELETE -H "Authorization: Bearer $KEY" "$API/subscriptions/ada%40example.com"
```

`POST /send` with no options runs exactly the sweep the in-process scheduler
runs, which is what lets an external cron replace it — set `dryRun` first while
wiring it up, since it reports every outcome and sends nothing.

The request body for a subscription is validated by the same schema the app's
own form posts through (`services/newsletter-input.ts`), so the two front doors
cannot drift: a field added for the app is accepted here on the same commit,
with the same bounds and defaults.

## Saving briefs to a drive (GOI-91)

Each brief is also filed as a **PDF** in a folder at the root of the user's own
cloud drive, on the same schedule as the email. Connect it under
**/my → Newsletter → Save briefs to a drive**.

The folder is named `Afisz.ka` by default and can be renamed from that panel.
Renaming **renames the folder in the drive** (`renameDriveFolder`) rather than
pointing the connection at a new one: the alternative strands every brief filed
so far in a folder the user has stopped looking at. The new name is stored only
once the drive has accepted it, so the panel never promises a folder that isn't
there. If the folder has been deleted, the rename is recorded and the cached
folder id dropped, which makes the next send recreate it under the new name —
`ensureFolder` re-verifies that a cached id is *live* but never that it still
carries the expected name, so a new name against a surviving stale id is the one
combination that must not be stored.

Only **Google Drive** is implemented. `services/cloud-drive.ts` is the
provider-independent half — a second provider is one object satisfying
`DriveProvider` plus its id in the union, with no change to the sweep, the
store or the UI.

**Scope is `drive.file`, deliberately.** It grants access only to files AFISZ
itself created, so the app can write into its own folder and can see nothing
else in the user's Drive. It is also non-sensitive, so it needs no Google
verification review — widening to `drive` would lose both properties.

Setup, beyond the sign-in credentials that already exist:

1. In the Google console, add `https://www.googleapis.com/auth/drive.file` to
   the OAuth consent screen's scopes.
2. Register the extra redirect URI `<API_PUBLIC_URL>/auth/google/drive/callback`
   verbatim, alongside the sign-in one.

No new environment variable: the flow reuses `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `API_PUBLIC_URL`. Without them the panel reports
that it isn't available instead of offering a button that can only fail.

The folder is created with no `parents`, which is how Drive is told "the root of
My Drive" — adding a parent would nest it somewhere the user didn't ask for.

Two properties worth keeping if this is edited:

- **A drive failure never costs the email.** `deliverBriefToDrives` runs after
  the send and after `markSent`, and never throws: a full, revoked or offline
  drive is recorded on the connection (and surfaced in the Newsletter tab), not
  raised into the sweep.
- **The consent URL is minted by a tRPC mutation, not a GET route.** The
  callback has to know whose drive it is completing, and it arrives as a
  top-level redirect with no Authorization header — so the user id rides in the
  HMAC-signed `state`. A start route would instead have to take the session in
  a query string, putting a live bearer token in browser history and logs.

The PDF is drawn from the same `BriefSection[]` the email renders from, not
converted from the email HTML — converting would mean shipping a headless
browser to Railway, and email markup is nested presentation tables built for
Outlook. Fonts are embedded (`backend/assets/fonts`, DejaVu subset to Latin-1 +
Latin Extended-A, 22KB each) because PDF's built-in Helvetica is WinAnsi and has
no ł, ą, ę, ś, ż, ź, ć or ń.

**Generate now** on the same tab downloads that identical PDF, so a brief sent
by hand and a brief filed on the drive are the same document (GOI-45).

## Proposing similar venues (GOI-86)

On **/my → My venues**, each non-empty folder carries a *"Propose similar
venues elsewhere"* action: give it a city and an optional type ("Museums") and
it suggests venues in that city resembling the ones already in the folder.

The folder is the point. Someone whose "Warsaw" folder holds POLIN, Zachęta and
the Museum of Modern Art is not asking for "museums in Berlin" — they want
*that kind* of museum, and a category filter cannot express it. So the folder's
venues (with the user's own tags, often the sharpest signal) go to the model as
exemplars.

Two properties worth keeping if this is edited:

- **Suggestions are proposals, never subscriptions.** "Add" runs the ordinary
  add-venue mutation, so each one is probed exactly like a pasted URL. A venue
  the model invented fails there, visibly, instead of quietly joining the folder
  and never producing an event.
- **It is a mutation, not a query.** Queries refetch on focus, on reconnect and
  on cache invalidation; none of those are moments the user asked to spend a
  model call.

Anything the user already follows — in any folder, matched on normalised URL
and on name+city — is filtered out of the results. Needs `ANTHROPIC_API_KEY`;
without it the panel reports that rather than failing silently.


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
   `https://afisz.cc/dev/` — check your updates there. The
   password's SHA-256 hash is baked into the dev build
   (`VITE_DEV_GATE_HASH` in `.github/workflows/deploy-frontend.yml`); the
   password itself is shared privately. The unlock persists per browser via
   `localStorage`. Note this is a client-side deterrent for a public static
   preview, not real security.
4. Once verified, open a PR `dev` → default branch. Merging redeploys the
   production site at the Pages root (no gate there).

To rotate the dev password: `printf '%s' 'new-password' | sha256sum` and put
the digest in `DEV_GATE_HASH` in `deploy-frontend.yml`.

### App icon and the dev variant

`frontend/public/icons/` holds two sets of the AFISZ mark:

| Set | Files | Used by |
|---|---|---|
| Production | `afisz-app-icon-*.png` | the default branch build, local dev |
| Dev preview | `afisz-dev-app-icon-*.png` | the `/dev/` build |

The dev set is the production mark with a red DEV foot across the bottom, so
a tab, a bookmark or an installed PWA reads as staging at a glance. Each set
has a 48px favicon, a 120px `apple-touch-icon`, a 512px PWA icon, and a 432px
maskable icon for Android adaptive icons.

The switch is `VITE_APP_VARIANT`, set per build step in
`deploy-frontend.yml`. `dev` makes the `appVariantIcons` plugin in
`frontend/vite.config.ts` rewrite `index.html` to the DEV icons and
`manifest.dev.webmanifest` and prefix the tab title with `DEV ·`, and makes
`Layout` put a DEV chip next to the wordmark. Anything else — including
unset, so `npm run dev` — gets the production mark.

The plugin runs after `landingPlugin`, so the title it prefixes is the one
`landingHead` generated from `src/landing/content.ts`; it matches the
`<title>` tag rather than any particular copy, so rewording the landing page
cannot silently drop the DEV marker. The landing page's own wordmark is not
marked — the tab, the icon and the app header are.

Replacing the artwork means replacing both sets; the DEV foot is baked into
the PNGs rather than drawn at runtime.

## Deploying the frontend to GitHub Pages

The workflow at `.github/workflows/deploy-frontend.yml` runs after CI passes
on `main`, builds `frontend/`, and deploys `dist/` to GitHub Pages via the
official `actions/configure-pages` → `actions/upload-pages-artifact` →
`actions/deploy-pages` pipeline.

One-time setup in the repo:

1. **Settings → Pages →** *Source: **GitHub Actions***.
2. **Settings → Secrets and variables → Actions → Variables → New variable**
   `VITE_API_URL` = the backend origin, `https://api.afisz.cc`.
3. Push to `main`. Once `CI` goes green, `Deploy frontend` runs and the site
   appears at `https://afisz.cc/`. You can also trigger it manually from
   **Actions → Deploy frontend → Run workflow**.

The site is served from the `afisz.cc` custom domain, so the Vite `base` the
workflow passes is `/` (`/dev/` for the password-gated preview); locally it
falls back to `/events_/`. In dev, the Vite proxy forwards `/trpc` to
`http://localhost:3001`, so `VITE_API_URL` can stay empty in `.env`. In
production it must be the API origin.

`VITE_API_URL` is baked in at build time, so changing the repo variable does
nothing until the workflow re-runs. See [`docs/DOMAINS.md`](docs/DOMAINS.md)
for the DNS records both hostnames need.

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
4. Add the custom domain `api.afisz.cc` (Settings → Networking) **and** the
   matching DNS record — see [`docs/DOMAINS.md`](docs/DOMAINS.md) — then set
   `VITE_API_URL` (repo Actions variable) to it and re-run the **Deploy
   frontend** workflow.

## Choosing an extraction model

`EXTRACTOR_MODEL` (default `claude-sonnet-4-6`) is what parses venue listings.
Sonnet is there because real venue markup is messy — Polish copy, ambiguous
date formats, dates split across elements — and a smaller model is a real
accuracy risk on that job.

That argument does not apply to every page. When a listing carries trustworthy
structured data, `preprocessForVenue` throws the HTML body away and sends only
the JSON payload, so the model's job is transcribing well-formed JSON into
well-formed JSON. `EXTRACTOR_MODEL_STRUCTURED` targets *that path only*, leaving
every HTML-parsing venue on Sonnet:

```bash
EXTRACTOR_MODEL_STRUCTURED=claude-haiku-4-5-20251001
```

It is unset by default. Measure before setting it:

```bash
npm run compare:models --workspace backend -- \
  test/fixtures/<fixture>.html <venue-slug> \
  claude-sonnet-4-6 claude-haiku-4-5-20251001
```

The harness sends the byte-identical prompt the scraper would send through each
model and reports rows extracted, rows surviving the validator, token counts,
wall time, and a field-level diff. It reads a saved fixture rather than
fetching the venue, so a comparison is repeatable on the same bytes. It needs
`ANTHROPIC_API_KEY` and costs real tokens.

**Adopt a candidate only if it loses no events.** A missing screening is a
screening no reader ever hears about, and it is invisible in aggregate counts —
which is why the harness diffs event-by-event rather than comparing totals.

### Where the LLM spend actually is

Worth knowing before optimising this: venues whose pages carry **≥2 JSON-LD
event nodes never reach the model at all**. `parseJsonLdEvents` maps them in
code for zero tokens, and the LLM is only a fallback for when that mapping
comes back empty. The structured path is therefore already close to free, and
the bulk of extraction cost sits on the HTML-parsing venues — the ones where
swapping the model is least safe. Both knobs above exist so that trade-off can
be measured rather than argued about.

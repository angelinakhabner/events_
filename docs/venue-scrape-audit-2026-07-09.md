# Venue scrape audit — 2026-07-09

Comparison of every default venue's **original listing page** (fetched exactly
the way the production scraper fetches it, from a GitHub Actions runner) against
the **events actually visible in the app** (production API
`events.listByVenue`). Produced by `backend/src/scripts/audit-venues.ts` via the
temporary `venue-audit.yml` workflow (runs #1–2); raw JSON is in the job logs.

Scrape windows per category: cinema 7d, comedy 21d, theatre 30d, music 45d,
exhibition 60d.

## Summary table

| Venue | Original site (fetched as scraper) | Visible in app | Verdict |
|---|---|---|---|
| Kino Muranów | fetch OK, calendar found (188k chars readable) | **89** events, 7 days, fresh | ✅ healthy |
| Kino Iluzjon | fetch OK (348k chars readable — very heavy LLM input) | **28** events, 7 days, fresh | ✅ works (cost concern) |
| Kinoteka | **251 screenings** in next 7 days via deterministic scraper | **3** stale rows (dates out to Jul 26) | 🔴 broken in prod |
| Teatr Powszechny | page is a JS shell — only **1,978 chars** readable | 4 events / 30-day window | 🔴 under-scraping |
| Nowy Teatr | fetch OK but no structured data, ~15k chars (known JS-heavy) | **0** events | 🔴 broken |
| TR Warszawa | fetch OK, 35k chars readable | **0** events | 🔴 broken |
| Teatr Dramatyczny | native fetch **HTTP 403** (WAF) | 13 events to Jul 19 | 🟠 works only via Firecrawl |
| Zachęta | fetch OK, 47k chars | 6 events / 60-day window | 🟠 thin |
| MSN | fetch OK (TLS chain quirk auto-handled) | 24 events, but horizon ends Jul 15 of a 60-day window | 🟠 short horizon |
| CSW Zamek Ujazdowski | fetch OK, 25k chars | **0** events | 🔴 broken |
| POLIN | native fetch **HTTP 403** (WAF) | 106 events to Jul 30 | 🟠 works only via Firecrawl |
| Muzeum Narodowe | fetch OK — but `/wystawy` lists undated, ongoing exhibitions | **0** events | 🔴 wrong source page |
| Królikarnia | fetch OK — same undated `/wystawy` shape | **0** events | 🔴 wrong source page |
| Klub Komediowy | **49 events** in next 21 days via deterministic scraper | **0** events | 🔴 scrape not run in prod |
| Filharmonia Narodowa | fetch OK, 39k chars | **0** events | 🔴 broken (verify: possible summer break) |
| Jazzmine | fetch OK, 137k chars | 14 events to Aug 6 | ✅ healthy |

The scheduler itself is alive: Muranów/Iluzjon rows extend exactly to today+7,
so the sweep ran recently. The failures are per-venue.

## Where scraping should be updated (priority order)

1. **Kinoteka** — the deterministic scraper extracts 251 valid screenings on a
   runner, yet production holds 3 stale rows. Either the deployed backend
   predates the deterministic scraper or its scrape run errors — check
   `scrape_runs` for `kinoteka` and force `scrape:one kinoteka`.
2. **Klub Komediowy** — deterministic scraper (merged Jul 8) extracts 49 valid
   events; production has none. Likely simply never scraped since the deploy —
   force a run, confirm the deploy includes it.
3. **Muzeum Narodowe + Królikarnia** — the seeded URLs (`/wystawy`) list
   *ongoing exhibitions without dates/times*, so the validator drops every row.
   Point the venues at their event-calendar pages (or teach the pipeline to emit
   date-range "exhibition" rows) — as-is they can never produce events.
4. **Nowy Teatr** — page is JS-rendered (already noted in `FIRECRAWL_WAIT_MS`
   docs); no JSON-LD, no `__NEXT_DATA__`. Needs Firecrawl rendering with a
   sufficient wait, or its JSON API endpoint if one exists.
5. **TR Warszawa** — page fetches fine with 35k readable chars, yet DB has 0
   events: the LLM extraction or validation is failing. Reproduce with
   `scrape:one tr-warszawa` and inspect the raw model output / validator logs.
6. **Filharmonia Narodowa** — 0 events across a 45-day window. July/August may
   genuinely be the off-season, but confirm by checking the page for
   September dates (window may need widening past the summer gap instead).
7. **Teatr Powszechny** — the month-parameterised page serves only ~2k chars of
   readable content (JS shell); only 4 events made it into the DB for a 30-day
   window. Needs rendering or a better source URL.
8. **CSW Zamek Ujazdowski** — fetch OK, readable content present, 0 events in
   DB. Same treatment as TR Warszawa: inspect a forced run.
9. **Zachęta / MSN** — working but thin (6 events; horizon ending 45 days
   early). Both listings likely paginate; consider following pagination or
   date-range URLs.
10. **Teatr Dramatyczny + POLIN** — currently produce events, but the native
    fetch path is 403-blocked (WAF), so they work *only* while Firecrawl keeps
    succeeding. Keep Firecrawl configured; consider per-venue alerting on
    `success_empty`/`failed` runs.

## App-side visibility (not a scraping bug, but part of "events are missing")

`events.listDefault` caps the Home feed at **100 events ordered
soonest-first**, which today collapses the visible horizon to ~3 days
(Jul 9 → Jul 12) and squeezes out sparse venues entirely (only 9 of 16 venues
appear at all; Muranów alone takes 49 of the 100 slots). Even a perfectly
scraped venue looks "invisible" on Home. Consider a higher limit + pagination,
or per-venue capping in the feed query.

## Fix round 1 — 2026-07-12

**🚨 Critical, found while force-triggering production scrapes: the production
backend is GONE.** `https://goinbackend-production.up.railway.app` returns
Railway's edge error `404 {"message":"Application not found"}` — the service
was deleted, renamed, or lost its domain some time after Jul 9 (when the
audit still got live data from it). Until it's restored (Railway dashboard →
service → networking/domain, then update the `VITE_API_URL` repo variable if
the URL changed and re-run *Deploy frontend*), the app shows nothing and no
scrape can run. Everything below is code-side work that takes effect on the
next deploy.

Landed on this branch:

- **MNW + Królikarnia** repointed from undated `/wystawy` pages to their real
  event calendars (migration 0007 moves rows in place). MNW uses the bounded
  month page via a new `{{MM-YYYY}}` URL placeholder — probe-verified: 122
  showtimes on the July page (the all-time Kalendarium is ~340k chars).
- **Stale-event pruning**: a successful scrape is now authoritative for its
  window — untouched rows inside `[today, today+windowDays]` are deleted.
  Kills the Kinoteka zombie rows (and any future ones) which upserts alone
  could never remove.
- **Kinoteka + Klub Komediowy**: their deterministic scrapers were re-verified
  from the runner (251 and 49 events respectively). Nothing to fix in code —
  the production gap is the dead backend / stale deploy; force
  `admin.triggerScrape` for both once it's back.

Diagnosed, not (yet) code-fixable:

- **TR Warszawa** — `/kalendarz/` and `/repertuar/` are the same JS shell;
  wp-json REST exposes no event route (tribe/spektakl/wydarzenie all 404,
  admin-ajax needs unknown params). Needs Firecrawl rendering in production.
- **Nowy Teatr** — `/pl/kalendarz` slightly richer than `/pl/repertuar` but
  still JS-rendered; `/pl/api/search` exists but rejects bare GETs. Firecrawl.
- **Teatr Powszechny** — React Server Components shell (~2k readable chars);
  Firecrawl.
- **Filharmonia** — the page IS server-rendered with events (August festival
  links, `?p=2..14` pagination). The 0-events state is likely an extraction or
  scheduler failure from before the outage — re-check with a forced scrape
  after restore; consider following pagination later.
- **CSW Zamek Ujazdowski** — readable content exists (6 ISO dates); re-check
  with a forced scrape after restore.

After the backend is restored, re-run the audit + a trigger sweep from
Actions: *Venue diagnose* → `trigger: kinoteka,klub-komediowy,tr-warszawa,
csw-zamek-ujazdowski,nowy-teatr,teatr-powszechny,filharmonia,muzeum-narodowe,
krolikarnia` and read the per-venue `run.status` / `errorMessage` in the log.

## Fix round 2 — 2026-07-12 (deterministic scrapers for the JS-shell venues)

Live pages were captured as fixtures from Actions runners (`capture` mode of
the venue-diagnose workflow) and each venue's real data source was found in
the markup. Five new deterministic scrapers — exact rows, zero Anthropic
tokens, no Firecrawl:

| Venue | Data source found | Notes |
|---|---|---|
| Filharmonia | `/repertuar` is server-rendered; `?p=N` pagination walked until past the window | Card dates lack a year → rolling-forward inference. **Summer break until 24.08** — the old "0 events" was real (Jul 9 + 45d window ended Aug 23, one day short) |
| MNW + Królikarnia | edito CMS month-list pages (`MM-YYYY,lista,miesiac.html`) — one shared parser | Branch-museum rows (Królikarnia/Poster Museum inside MNW's calendar) dropped via same-host filter. Venue URLs moved to the lista variant (migration 0007 updated pre-ship) |
| TR Warszawa | `/kalendarz/YYYY/MM/?view=calendar` month pages (the site's own PJAX calendar is server-rendered) | Tiles carry HH:MM–HH:MM → real durations. New `{{MM}}` placeholder; migration 0008. Dark over the summer |
| CSW Zamek Ujazdowski | `/en/wydarzenia/week.ajax?ut=<midnight-Warsaw epoch>` day fragments (~6 kB each) | One fragment per window day; venue URL unchanged |
| Nowy Teatr | `/pl/kalendarz?date_from=…&date_to=…` — the filter form's no-JS fallback renders the agenda server-side | One GET per month; timeless festival banners skipped; migration 0009. Dark over the summer |

Still LLM/Firecrawl-path after this round: **Teatr Powszechny** (Next.js RSC —
the repertoire streams behind a Suspense boundary a plain GET never receives;
needs Firecrawl), plus the already-working Muranów/Iluzjon/Zachęta/MSN and the
WAF-blocked POLIN/Dramatyczny (Firecrawl).

Scorecard after both rounds: **11 of 16 venues deterministic** (Kinoteka,
Komediowy, Filharmonia, MNW, Królikarnia, TR Warszawa, CSW, Nowy Teatr + the
JSON-LD path), 4 on the LLM path, 1 Firecrawl-only. Everything lands in
production on the next deploy + scrape once the Railway backend is restored.

## Fix round 3 — 2026-07-23 (the two remaining theatres)

Production status first: the Railway backend came back online on Jul 23 (16
venues resolve, home feed serves). But it still runs pre-Jul-18 code — every
deterministic-scraper venue shows 0 (or stale) events in the app while its
scraper extracts fine from a runner (Kinoteka 231, Komediowy 44, Filharmonia
15, MNW 81, Królikarnia 13, CSW 34). **A redeploy from the current default
branch is still the unblocking step**; check the service's tracked branch —
`main` no longer exists.

- **Teatr Powszechny — now deterministic.** The repertuar page is a Next.js
  RSC shell; the repertoire never appears in the served HTML (hence the ~2k
  readable chars and thin LLM results). The page's own client code loads
  `GET /api/repertoire?lang=pl` — complete JSON with a UUID per showing, UTC
  start instant, running time, stage, category and per-showing notes. The new
  scraper (`venues/powszechny.ts`) reads that endpoint directly: exact rows,
  zero tokens, no Firecrawl, venue URL unchanged. Audit-verified from a
  runner: fetch OK, 39 showings parsed from the live API (0 inside the
  current 30-day window — the theatre is dark until 19.09, like TR Warszawa
  and Nowy Teatr).
- **Teatr Dramatyczny — confirmed Firecrawl-only.** A runner-side fetch of
  `/repertuar/` with a full browser header set (Chrome UA, Sec-Fetch-*,
  client hints) still gets HTTP 403 with a ~5.7 kB challenge page: the WAF
  fingerprints beyond headers (TLS/IP), so no native deterministic path
  exists. Production scrapes it successfully via Firecrawl today (20
  September events) — keep that path.

Scorecard after round 3 (per today's audit run): **9 venues with dedicated
deterministic scrapers** (Kinoteka, Komediowy, Filharmonia, MNW, Królikarnia,
TR Warszawa, CSW, Nowy Teatr, Powszechny), 5 on the LLM path (Muranów,
Iluzjon, Zachęta, MSN, Jazzmine — plus the generic JSON-LD short-circuit when
a page carries it), 2 WAF-blocked venues on Firecrawl (Dramatyczny, POLIN).

## Housekeeping

- `venues.list` returns 16 venues for 15 defaults — one leftover row (venue
  removed from the defaults is never deleted by the seed). Worth a cleanup
  migration.
- `events.listByVenue` 500s when given a non-UUID id (raw `::uuid` cast in the
  store). Harmless for the frontend (it uses real ids) but worth a guard.

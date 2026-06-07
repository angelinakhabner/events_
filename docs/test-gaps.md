# Test coverage audit

Snapshot of where tests exist, where they're thin, and what's untested — ordered
by risk. Produced for Milestone-3 hardening.

## Important context: the scrape pipeline isn't built

Several high-value integration scenarios (full fetch → Claude → validate →
persist, hash-skip cost savings, `scrape_runs` accounting) **cannot be tested
yet** because that pipeline does not exist:

- `services/scraper.ts` only fetches HTML; `services/ai-parser.ts` only calls
  Claude and throws on any invalid entry. Nothing orchestrates, persists, hashes,
  or records runs.
- There is no `events` table, no `scrape_runs` table, and no
  `backend/test/fixtures/muranow.html` fixture.

So the gaps below are about the code that **does** exist. Building the pipeline
(and its integration tests) is tracked separately — see the report at the end of
this audit and `docs/ARCHITECTURE.md`.

## Modules with NO tests

| Module | Risk | Notes |
|---|---|---|
| `services/email.ts` | **High** | `escapeHtml` is HTML-injection-relevant and untested; `welcomeEmail` pure; `sendEmail` side-effecting |
| `data/default-events.ts` | **High** | `generateDefaultEvents` is the **actual production data source for Home** today — zero tests |
| `services/ai-parser.ts` → `parseEventsFromHtml` | **High** | Core AI ingestion + zod validation; only the helper `extractJson` is tested |
| `db/migrate.ts` | Medium | `runMigrations`/`dropAll`; exercised indirectly by CI, no unit test |
| `config.ts` | Low | env parsing; low logic |
| `trpc/router.ts` (`events.listDefault`, `folders.getEvents`) | Medium | partially hit by integration `api.test.ts`, no direct unit tests |
| `data/default-venues.ts` | Low | static data |

## Modules with WEAK coverage (happy-path only)

| Module | What's covered | What's missing |
|---|---|---|
| `services/filters.ts` (`matchesEvent`) | category, city, priceMax, list | **daysOfWeek, startHour, endHour, countries**, null-price pass-through, `undefined` venue — none of the time/day branches are tested, and they carry a timezone bug (uses server-local `getHours`/`getDay`) |
| `services/ai-parser.ts` (`extractJson`) | raw + fenced JSON | malformed / non-JSON input (the failure path that matters) |
| `services/scraper.ts` | ok + non-ok status | network throw / non-string body — low priority |
| `services/cache.ts` | get-before-expiry, evict | `delete`, overwrite — low priority |
| `services/venue-store.ts` | list/add/slug/cities/categories | duplicate-add throw, `remove` |
| `services/folder-store.ts` | `InMemoryFolderStore` full | `DbFolderStore` only via integration when `DATABASE_URL` is set |
| `frontend EventList` | — | `groupByDay` sort/group not unit-tested |

## Critical untested logic, in order of risk

1. **`parseEventsFromHtml`** (`ai-parser.ts`) — turns Claude output into validated
   events. Untested validation behavior; currently throws if *any* entry is
   invalid (no graceful degradation). Highest blast radius once wired.
2. **`matchesEvent` time/day branches** (`filters.ts`) — production filtering with
   a real timezone correctness issue and zero coverage on those branches.
3. **`generateDefaultEvents`** (`default-events.ts`) — literally what every Home
   visitor sees right now; epoch-anchoring + `endsAt` math untested.
4. **`extractJson` failure path** (`ai-parser.ts`) — malformed Claude responses.
5. **`escapeHtml` / `welcomeEmail`** (`email.ts`) — HTML escaping in outbound mail.

## Tests added in this pass (unit)

Covering the top 5 above:

- `ai-parser.test.ts` — extended: `parseEventsFromHtml` with a **mocked Anthropic
  SDK** (valid array → parsed events; invalid entry → throws); `extractJson`
  malformed-input cases.
- `filters.test.ts` — extended: `daysOfWeek`, `startHour`/`endHour` boundaries
  (computed TZ-robustly), `countries`, null-price pass-through, `undefined` venue.
- `default-events.test.ts` — new: determinism, epoch anchoring, future anchoring,
  `endsAt` computation, ids/count/links.
- `email.test.ts` — new: `welcomeEmail` escapes HTML in the name; subject carries
  the raw name.

## Still outstanding (not done in this pass — blocked or lower priority)

- **All scrape-pipeline integration tests** (fixture → Claude-mock → persist;
  hash-skip; malformed degradation; `scrape_runs` accounting). **Blocked:** the
  pipeline, `events`/`scrape_runs` tables, and the Muranów fixture don't exist.
- `events.listDefault` "future-only / Warsaw-only / sorted / limit" end-to-end —
  `listDefault` doesn't yet implement future-filtering, sorting, or `limit`, so
  the scenario can't be asserted as specified.
- `DbFolderStore` direct unit tests, `db/migrate.ts`, `EventList.groupByDay`,
  `venue-store` duplicate/remove, `cache.delete` — lower risk.

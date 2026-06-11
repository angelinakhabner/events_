# Milestone 3 — Filters that actually filter

**Status:** Plan only. Nothing in this document is implemented yet.

## Where M2 actually left things

Before planning M3 it's worth being precise about what exists today, because
some of M3 is already half-built:

- **`EventFilters`** (`shared/src/index.ts`) already defines: `categories`,
  `cities`, `countries`, `daysOfWeek`, `startHour`, `endHour`, `priceMax`.
- **Backend filtering already works.** `services/filters.ts` (`matchesEvent` /
  `filterEvents`) applies those dimensions, and both `events.listDefault` and
  `folders.getEvents` run events through it server-side. So "filters that
  actually filter" is partially true on the backend **today**.
- **The UI is the weak point.** `FilterBar.tsx` only exposes *categories* and
  *startHour/endHour*. There is no UI for price, day-of-week, date range,
  language, or venue, and **filter state is local `useState`** — not in the URL,
  not persisted.
- **Events are mock data.** `generateDefaultEvents()` produces a deterministic
  in-memory set; there is no `events` table yet. M3 should be written so it
  works unchanged once events are DB-backed (M2-proper).
- **Grouping is by calendar day**, not "4 time-of-day buckets." `EventList.tsx`
  groups by `formatDayKey`. The "4-bucket" framing in the M3 brief doesn't match
  the code — see [§ Filters × grouping](#filters--the-time-grouping) for how to
  reconcile.

M3 is therefore mostly: **(a) close the gap between the filter schema and the UI,
(b) make filter state URL-encodable/shareable, (c) fix the timezone semantics,
and (d) extend the dimensions** (date range, language, venue, price in the bar).

## 1. Filter dimensions

| Dimension | Exists in schema? | Exists in UI? | M3 work |
|---|---|---|---|
| Category | ✅ `categories` | ✅ | none (already works) |
| Date range | ❌ | ❌ | add `dateFrom`/`dateTo` (ISO date, inclusive) |
| Time-of-day | ✅ `startHour`/`endHour` | ✅ | fix timezone semantics (see §7) |
| Day-of-week | ✅ `daysOfWeek` | ❌ | add chips Mon–Sun |
| Max price | ✅ `priceMax` | ❌ | add slider / numeric input (currency: zł) |
| Language | ❌ | ❌ | add `languages: string[]` (venue-level) |
| Venue | partial (`cities`) | ❌ | add `venueIds: string[]` for explicit venue picks |

New `EventFilters` shape (additive, all optional — backward compatible with
stored folder filters):

```ts
interface EventFilters {
  categories?: Category[];
  cities?: string[];
  countries?: string[];
  daysOfWeek?: number[];     // 0–6, local to venue timezone
  startHour?: number;        // 0–23, "starts at or after"
  endHour?: number;          // 0–23, "starts at or before"
  priceMax?: number;         // currency-naive for now (zł)
  // new in M3:
  dateFrom?: string;         // 'YYYY-MM-DD' inclusive
  dateTo?: string;           // 'YYYY-MM-DD' inclusive
  languages?: string[];      // matched against venue.language
  venueIds?: string[];       // explicit venue allow-list
}
```

## 2. Filter state representation (URL-encodable)

Filters must be shareable, so the canonical home is the **URL query string**.

- One query param per dimension, human-readable where cheap:
  - `?cat=cinema,theatre&day=5,6&from=2026-06-10&to=2026-06-20&after=18&before=23&max=40&lang=en&venue=kino-muranow`
- A small codec module `frontend/src/lib/filter-url.ts`:
  - `filtersToSearchParams(f: EventFilters): URLSearchParams`
  - `filtersFromSearchParams(p: URLSearchParams): EventFilters`
  - Round-trip stable; omit empty/undefined keys so a clean URL = no filters.
- Home reads/writes via `useSearchParams` (react-router is already a dep), so
  the state lives in one place and back/forward + copy-link "just work."
- Folders keep storing the **same `EventFilters` JSON** in `folders.filters`
  (already the case). The URL codec and the stored JSON are two encodings of one
  type; never invent a second filter shape.

Why not base64-encode a blob? Readable params are debuggable, diffable, and let
us evolve keys with graceful fallback. The cost (a codec) is small.

## 3. Where filtering happens — recommend **backend**

Recommendation: **filter on the backend**, keep the client dumb. It already is.

Reasons:
- **Correctness/consistency.** One implementation (`filters.ts`) already serves
  both Home and folders. Duplicating it client-side invites drift.
- **Scales past mock data.** Once events are DB-backed, filtering becomes a
  `WHERE` clause + index; we do not want to ship thousands of rows to filter in
  the browser.
- **Pagination/limit.** Server-side filtering is a prerequisite for correct
  `limit`/`cursor` paging. Client filtering breaks paging.
- **Shareable URLs still work**, because the client just maps URL → input →
  tRPC query. The server is the single source of truth for *which* events match.

The only client-side "filtering" should be cosmetic grouping/sorting of an
already-filtered list.

Migration note for DB-backed events: port `matchesEvent` predicates to Drizzle
`WHERE` conditions. Time-of-day/day-of-week need a timezone-aware expression
(see §7) — compute against `venue` timezone, not the server's.

## 4. Filters × the time grouping

Two things often conflated:

- **Filtering** decides *which* events appear (backend).
- **Grouping** decides *how they're laid out* (frontend, `EventList`).

Today grouping is **by calendar day**. The brief mentions a "4-bucket time
grouping" (morning / afternoon / evening / late). That does **not** exist yet.
Decision for M3: **keep day grouping as the primary axis**, and *optionally* add
a sub-grouping or sort within a day by time-of-day bucket. Interaction rules:

- Time-of-day **filter** (`startHour`/`endHour`) narrows the set *before*
  grouping. If "after 18:00" is set, morning events simply aren't in the data
  the grouper sees — no empty buckets.
- If we add 4 buckets as a *display* option, an active time filter just means
  some buckets render empty/absent. Buckets are presentation; they never filter.
- Day-of-week and date-range filters interact only with the day grouping by
  removing whole day-sections.

If product actually wants 4 hard buckets instead of per-day sections, that's a
separate `EventList` change; this plan assumes day-sections stay and time-bucket
is at most a within-day sort. Flag for product before building buckets.

## 5. UI sketch

```
┌ What's on ───────────────────────────────────────────────┐
│  [ cinema ] [ theatre ] [ exhibition ] [ comedy ]   ⟵ category chips
│  From [18:00 ▾]  Until [23:00 ▾]   Price ≤ [ 40 zł ]      │
│  Days [M][T][W][T][F][S][S]   Dates [Jun 10]–[Jun 20]     │
│  Lang [en ▾]   Venue [Kino Muranów ✕] [+ add]            │
│                                                           │
│  Active: cinema · After 18:00 · ≤40 zł · Fri,Sat  [Clear all] │
└───────────────────────────────────────────────────────────┘
```

- **Location.** The filter bar stays where it is on Home — directly under the
  "What's on" header, inside the existing `border-y` band wrapping `FilterBar`.
  Keep it sticky on scroll (long event lists) as a nice-to-have.
- **Active filters.** A single summary line (reuse/extend `filterSummary` in
  `lib/format.ts`, which already renders categories/hours/price). Each active
  filter is a removable chip; clicking the ✕ clears just that dimension.
- **Clear them.** A "Clear all" affordance appears only when ≥1 filter is
  active; it sets filters to `{}` and clears the URL params. Per-chip ✕ clears
  one dimension. (Home already wires a "Reset filters" action in `EmptyState`
  for the no-match case — keep that.)
- **Empty/loading/error** states already exist in `states.tsx`; reuse.

## 6. Tests

**Unit (backend, `filters.test.ts` — extend):**
- Each new dimension: `dateFrom`/`dateTo` inclusivity (boundary days),
  `languages` (venue match + missing-language venue), `venueIds` allow-list.
- Combination/AND semantics: two filters both must pass.
- Timezone: "after 18:00" returns the right events given a known venue TZ (§7).

**Unit (frontend codec, `filter-url.test.ts` — new):**
- `filters → params → filters` round-trips for every dimension and the empty
  set (`{}` ⇄ no params).
- Tolerates junk/extra params without throwing.

**Component (frontend, `FilterBar.test.tsx` — extend):**
- Toggling a category/day chip calls `onChange` with the right delta.
- "Clear all" only renders when something is active and resets to `{}`.
- Removing one chip clears only that dimension.

**Integration (backend, tRPC):**
- `events.listDefault` with a representative multi-dimension filter returns
  exactly the expected event ids against the deterministic mock set.
- `folders.getEvents` applies the folder's stored filters AND venue scoping.

## 7. Edge cases

- **Empty filter set (`{}`):** return everything (current behavior). The URL
  codec must treat "no params" and `{}` as identical.
- **No matching events:** backend returns `[]`; Home shows the existing
  `EmptyState` with "Reset filters." Don't error.
- **Timezone-aware "after 18:00" (the real bug today):** `matchesEvent` uses
  `new Date(startsAt).getHours()/getDay()`, which is the **server's** local
  timezone. On Railway (UTC) "after 18:00" means 18:00 UTC = 20:00 in Warsaw —
  wrong. Fix: compare against the **venue's** timezone (Europe/Warsaw for the
  seed). Add `venue.timezone` (default `Europe/Warsaw`) and evaluate hour/day
  using `Intl.DateTimeFormat`/a TZ lib against that zone, not the process zone.
  This must be fixed for time/day filters to be trustworthy.
- **Filters that don't apply to a venue type:** `language` and (future)
  `director` are cinema-centric. Rule: a filter only *excludes* a venue when the
  field exists and mismatches. A theatre with no `director` field is **not**
  excluded by a director filter; a venue whose `language` is unset is not
  excluded by a language filter (treat unknown as "doesn't disqualify"). This
  keeps non-cinema venues from silently vanishing when cinema filters are on.
- **Price with nulls:** events with no price (free/unknown) — current code lets
  `priceMax` pass when price is `null`. Keep: absence ≠ "too expensive."
- **daysOfWeek across midnight / DST:** evaluate the *local* day in venue TZ.

## 8. Persistence on Home — recommendation

**Recommendation: URL is the source of truth; do _not_ silently persist Home
filters across visits via localStorage by default.**

- A bare visit to `/` (no query params) shows the **unfiltered** default set.
  This is the least surprising for a shared/curated landing view and makes
  shared links deterministic (the link's params fully define what's shown).
- Persisting silently in localStorage causes the classic "why is the page
  filtered and I don't know why" confusion, and makes shared links ambiguous.
- **Compromise if product wants stickiness:** remember the *last* filter set in
  localStorage but only **offer** to restore it ("Restore your last filters")
  rather than auto-applying. Folders already provide durable, named, persistent
  filter sets — that's the intended home for "save my filters," so Home doesn't
  need to.

So: Home filters live in the URL (shareable, back/forward-friendly), reset on a
clean visit; folders remain the persistence mechanism.

## 9. Suggested implementation order

1. Fix timezone semantics in `filters.ts` (+ `venue.timezone`) — correctness first.
2. Extend `EventFilters` with `dateFrom/dateTo/languages/venueIds` + backend predicates + tests.
3. Add `lib/filter-url.ts` codec + tests; wire Home to `useSearchParams`.
4. Expand `FilterBar` UI (price, days, dates, language, venue) + active-chip summary + clear.
5. (Optional, product-gated) time-of-day buckets in `EventList`.

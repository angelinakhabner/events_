import { useState } from 'react';
import type { Category, ProbeOutcome, ProbeSampleEvent, SourceMethod } from '@afisz/shared';
import {
  VENUE_SEARCH_MAX_WINDOW_DAYS,
  VENUE_SUGGEST_MAX_CANDIDATES,
  VENUE_SUGGEST_PROBE_CONCURRENCY,
} from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { categoryLabel } from '../lib/format';

/**
 * "Elsewhere" — venue discovery for a city you don't follow yet (GOI-92).
 *
 * The search is the sentence someone actually says: *jazz concerts in
 * Thessaloniki tomorrow*. A city, the dates you'll be there, the kind of
 * venue, and — because a genre is not a category — what you're after in your
 * own words. A folder of your own venues can still be handed in as a taste
 * signal, but it is now one input among several rather than the premise.
 *
 * Three things then happen behind one button. The ask goes to the model and
 * comes back as candidates in the city you named; every candidate is run
 * through the *existing* probe ladder, so what you see beside each name is
 * whether we could actually read its programme; and the ones you tick are
 * written into a destination folder, created on commit if it doesn't exist.
 *
 * Three rules shape the rest of this file:
 *
 * - **Firecrawl is never run here.** A candidate that only a paid browser
 *   render could read is *flagged* as such and nothing is spent. Running it is
 *   a separate, per-venue decision on the venue's own row.
 * - **A failing probe does not delete the candidate.** A real venue with a bad
 *   website is still a real venue; it is addable with the reason attached, so
 *   the row later says why it isn't populating instead of just looking empty.
 * - **The dates are checked, not claimed.** The model is never asked what is
 *   on tomorrow — it cannot know. The probe reads each venue's own programme,
 *   and the entries it read are what the date line reports. That line is
 *   always about *what we could read*, never about what exists.
 */

export interface ElsewhereFolder {
  id: string;
  name: string;
}

/** Operator vocabulary, as the ticket asks it to be shown: "JSON-LD", "iCal",
 *  "RSS". Deliberately the method name rather than a gloss — this line answers
 *  "how will this be read", and the gloss lives on the venue's own row. */
const METHOD_LABEL: Record<SourceMethod, string> = {
  jsonld: 'JSON-LD',
  ical: 'iCal',
  wp_rest: 'WordPress events API',
  wp_rest_posts: 'WordPress posts',
  rss: 'RSS',
  llm_extract: 'Read from the page',
  firecrawl: 'Browser render',
  manual: 'Configured by hand',
};

/** The venue types a search may ask for. The app's own category vocabulary
 *  minus 'other' — a search for "other" narrows nothing, and the model is not
 *  offered that bucket either. */
export const SEARCH_TYPES: Category[] = ['music', 'cinema', 'theatre', 'exhibition', 'comedy'];

export type CandidateStatus = 'checking' | 'ok' | 'needs_paid' | 'failed';

/** What a probe outcome means for a discovery row. `undefined` is the row
 *  whose probe is still in flight — results stream in one at a time. */
export function candidateStatus(outcome: ProbeOutcome | undefined): CandidateStatus {
  if (!outcome) return 'checking';
  if (outcome.status === 'success') return 'ok';
  return outcome.code === 'JS_RENDERED_NEEDS_PAID' ? 'needs_paid' : 'failed';
}

/**
 * The one sentence a row shows about its probe. Never "couldn't check": every
 * failure the probe can produce is already a specific, translated sentence,
 * and this passes it through rather than flattening it.
 */
export function candidateNote(outcome: ProbeOutcome | undefined): string {
  if (!outcome) return 'Checking…';
  if (outcome.status === 'success') {
    return outcome.shared
      ? `Already tracked — ${METHOD_LABEL[outcome.method]}`
      : METHOD_LABEL[outcome.method];
  }
  if (outcome.code === 'JS_RENDERED_NEEDS_PAID') {
    return 'Only a paid browser render would read this — not run here.';
  }
  return outcome.message;
}

/** The probe verdict as the add mutation persists it, so an added venue keeps
 *  the reason it won't populate (GOI-92). */
export function probeFacts(outcome: ProbeOutcome | undefined) {
  if (!outcome) return undefined;
  if (outcome.status === 'success') {
    return {
      sourceUrl: outcome.sourceUrl,
      sourceMethod: outcome.method,
      sourceConfidence: outcome.confidence,
    };
  }
  return {
    probeErrorCode: outcome.code,
    requiresPaidFetch: outcome.code === 'JS_RENDERED_NEEDS_PAID',
  };
}

/* ── Dates ─────────────────────────────────────────────────────────────── */

/** A `Date` as the `YYYY-MM-DD` a date input holds. Local fields, not
 *  `toISOString()`: "tomorrow" has to mean tomorrow on the user's calendar,
 *  and an evening in Warsaw is already the next day in UTC. */
export function isoDay(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function shiftDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export type WindowPreset = 'today' | 'tomorrow' | 'weekend' | 'week';

/**
 * The presets, because the ask this panel exists for is "tomorrow" — typing
 * two dates to say it would be the interface arguing with the sentence.
 *
 * "This weekend" is the only one with a decision in it: on a Saturday it means
 * today and Sunday, on a Sunday it means today, and on any other day it means
 * the Saturday and Sunday still to come. Never the weekend just gone.
 */
export function presetWindow(preset: WindowPreset, today: Date = new Date()): { from: string; until: string } {
  if (preset === 'today') return { from: isoDay(today), until: isoDay(today) };
  if (preset === 'tomorrow') {
    const t = shiftDays(today, 1);
    return { from: isoDay(t), until: isoDay(t) };
  }
  if (preset === 'week') return { from: isoDay(today), until: isoDay(shiftDays(today, 6)) };
  const dow = today.getDay(); // 0 = Sunday, 6 = Saturday
  if (dow === 0) return { from: isoDay(today), until: isoDay(today) };
  const saturday = dow === 6 ? today : shiftDays(today, 6 - dow);
  return { from: isoDay(saturday), until: isoDay(shiftDays(saturday, 1)) };
}

/** Whole days from one ISO day to the next (a one-day window is 0). Parsed at
 *  midnight UTC, so no month or DST boundary can make this off by one. */
export function daysBetween(from: string, until: string): number {
  return Math.round(
    (Date.parse(`${until}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

/** Why these two dates can't be searched, or null. Shown next to the fields
 *  and used to hold the button, so the server's own refusal is never the first
 *  time anyone hears about it. */
export function windowProblem(from: string, until: string): string | null {
  if (!from || !until) return null;
  if (until < from) return 'The end of the window is before its start.';
  if (daysBetween(from, until) > VENUE_SEARCH_MAX_WINDOW_DAYS) {
    return `Dates can span at most ${VENUE_SEARCH_MAX_WINDOW_DAYS} days — few venues publish further ahead.`;
  }
  return null;
}

const DAY_LABEL_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
});

/**
 * "Fri 11 Sep", from either an ISO day or a full timestamp.
 *
 * The date part of the string is taken as written and rendered in UTC rather
 * than converted into the app's Warsaw clock. A listing in Thessaloniki says
 * which day it is on; re-basing that onto another timezone can move a late
 * evening onto the day before, and this line would then disagree with the
 * window that matched it.
 */
export function dayLabel(iso: string): string {
  return DAY_LABEL_FMT.format(new Date(`${iso.slice(0, 10)}T00:00:00.000Z`));
}

/**
 * The entries the probe read that fall inside the window — the whole point of
 * asking for dates.
 *
 * Undated entries (a permanent exhibition) are not matches: they are not "on"
 * on any particular day, and counting them would make every museum look like a
 * hit for every window.
 */
export function eventsInWindow(
  outcome: ProbeOutcome | undefined,
  from: string,
  until: string,
): ProbeSampleEvent[] {
  if (!outcome || outcome.status !== 'success' || (!from && !until)) return [];
  return outcome.sampleEvents.filter((e) => {
    if (!e.startsAt) return false;
    const day = e.startsAt.slice(0, 10);
    return (!from || day >= from) && (!until || day <= until);
  });
}

/**
 * What a readable candidate's row says about the window.
 *
 * The negative case is the careful one. A probe samples the first few entries
 * it finds, so "nothing in your dates" is a statement about what we read, not
 * about the venue's programme, and the sentence says so rather than implying
 * the place is dark that week.
 */
export function windowNote(
  outcome: ProbeOutcome | undefined,
  from: string,
  until: string,
): string | null {
  if (!from && !until) return null;
  if (!outcome || outcome.status !== 'success') return null;
  const hits = eventsInWindow(outcome, from, until);
  if (hits.length > 0) {
    const shown = hits.slice(0, 3).map((e) => `${e.title} — ${dayLabel(e.startsAt!)}`);
    return `In your dates: ${shown.join(' · ')}${hits.length > shown.length ? ` (+${hits.length - shown.length} more)` : ''}`;
  }
  if (outcome.sampleEvents.length === 0) {
    return 'Readable, but no dated listing came back to check your dates against.';
  }
  return 'Nothing in your dates among the listings we sampled — its programme may still be worth a look.';
}

/**
 * Probe a batch with a fixed number in flight, reporting each result the
 * moment it lands rather than when the batch finishes.
 *
 * The concurrency cap is doing two jobs: eight probes at once would be a
 * visible burst at a small venue's server, and a search that fanned out
 * unbounded is exactly the failure the ticket names.
 */
export async function probeWithConcurrency(
  urls: string[],
  probe: (url: string) => Promise<ProbeOutcome>,
  onResult: (url: string, outcome: ProbeOutcome) => void,
  concurrency: number = VENUE_SUGGEST_PROBE_CONCURRENCY,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      if (url === undefined) return;
      try {
        onResult(url, await probe(url));
      } catch (e) {
        // A transport failure is still a per-row answer: one dead candidate
        // must not leave the other seven stuck on "Checking…".
        onResult(url, {
          status: 'failure',
          normalizedUrl: null,
          code: 'UNREACHABLE',
          severity: 'retryable',
          message: e instanceof Error ? e.message : 'This venue could not be checked.',
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()),
  );
}

const PRESETS: { key: WindowPreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'weekend', label: 'This weekend' },
  { key: 'week', label: 'Next 7 days' },
];

export function ElsewherePanel({ folders, activeFolderId, onAdded }: {
  folders: ElsewhereFolder[];
  /** The folder whose venues seed the search by default. */
  activeFolderId: string | null;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState('');
  const [interest, setInterest] = useState('');
  const [types, setTypes] = useState<Category[]>([]);
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  /**
   * Which folder's taste is being matched, if any.
   *
   * `null` is "not chosen": the reader has not touched the control, so it
   * follows the folder they are in. `''` is a choice — match nothing, just
   * search — which is why the two cannot be the same value.
   *
   * That distinction is also what keeps GOI-116 fixed. The panel's folders
   * arrive from a query, so on the first render there are none and
   * `activeFolderId` is null; a plain `useState(activeFolderId ?? '')` reads
   * that once and is ignored on every later render, leaving the state on
   * "nothing" after the folders landed while the select showed something
   * else. Resolving the choice on each render against the folders that
   * actually exist is the fix. The dead-button half of that bug is gone
   * rather than guarded: a search with no folder behind it is a real search
   * now, so nothing chosen here can disable `Propose`.
   */
  const [matchChoice, setMatchChoice] = useState<string | null>(null);
  const preferred = matchChoice ?? activeFolderId ?? '';
  const matchAgainst = folders.some((f) => f.id === preferred) ? preferred : '';
  /** '' means "the new city folder" — the default, and the only destination
   *  that doesn't exist yet. */
  const [destination, setDestination] = useState('');
  const [probes, setProbes] = useState<Record<string, ProbeOutcome>>({});
  const [added, setAdded] = useState<string[]>([]);
  /** The window the results on screen were searched for. Kept apart from the
   *  live fields so editing the dates after a search doesn't relabel rows that
   *  were matched against the old ones. */
  const [searched, setSearched] = useState<{ from: string; until: string }>({ from: '', until: '' });

  const utils = trpc.useUtils();
  const suggest = trpc.my.venues.suggestSimilar.useMutation();
  const add = trpc.my.venues.add.useMutation({
    onSuccess: (_data, vars) => {
      setAdded((prev) => [...prev, vars.url]);
      onAdded();
    },
  });

  const matchFolder = folders.find((f) => f.id === matchAgainst);
  const dateProblem = windowProblem(from, until);
  const activePreset = PRESETS.find((p) => {
    const w = presetWindow(p.key);
    return w.from === from && w.until === until;
  })?.key;

  const toggleType = (c: Category) =>
    setTypes((prev) => (prev.includes(c) ? prev.filter((t) => t !== c) : [...prev, c]));

  const applyPreset = (key: WindowPreset) => {
    const w = presetWindow(key);
    setFrom(w.from);
    setUntil(w.until);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = city.trim();
    if (!target || dateProblem) return;
    setAdded([]);
    setProbes({});
    setSearched({ from, until });
    let result;
    try {
      result = await suggest.mutateAsync({
        ...(matchAgainst ? { listId: matchAgainst } : {}),
        city: target,
        ...(interest.trim() ? { interest: interest.trim() } : {}),
        ...(types.length ? { types: types.map((t) => categoryLabel(t)) } : {}),
        ...(from ? { from } : {}),
        ...(until ? { until } : {}),
        limit: VENUE_SUGGEST_MAX_CANDIDATES,
      });
    } catch {
      return; // rendered from suggest.error below
    }
    // allowPaid stays false: this is the whole "never auto-run Firecrawl"
    // guarantee, enforced at the only call site that could break it.
    await probeWithConcurrency(
      result.suggestions.map((s) => s.url),
      (url) => utils.client.my.venues.checkUrl.mutate({ url, allowPaid: false }),
      (url, outcome) => setProbes((prev) => ({ ...prev, [url]: outcome })),
    );
  };

  const results = suggest.data?.suggestions ?? [];
  const destinationLabel = city.trim() || 'the city';
  const hasWindow = Boolean(searched.from || searched.until);
  const withHits = hasWindow
    ? results.filter((s) => eventsInWindow(probes[s.url], searched.from, searched.until).length > 0)
    : [];

  /* The trigger and the form it opens are one component so the form can be
     full-width *below* the row the trigger sits in — the row itself only ever
     holds two controls. `min-w-0 truncate` is what makes this collapse before
     "+ Add venue" does when the row runs out of width. */
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="act act-on act-sm min-w-0 truncate text-xs"
      >
        Elsewhere
      </button>
      {open ? (
    <div className="mt-4 w-full border-3 border-ink p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h4 className="label-caps m-0">Find venues elsewhere</h4>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-extrabold uppercase text-muted hover:text-accent cursor-pointer bg-transparent border-0 p-0"
        >
          Close
        </button>
      </div>

      {/* One column on a phone, two from `sm` up: this form is mostly used on
          the screen it was reported from. */}
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label-caps mb-2">City</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Thessaloniki"
            className="field text-sm"
          />
        </label>

        <label className="block">
          <span className="label-caps mb-2">Looking for</span>
          {/* The free-text half of the ask. "Jazz" is not a venue category and
              never will be — a dropdown alone cannot hold what people are
              actually after. */}
          <input
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
            placeholder="Jazz concerts"
            className="field text-sm"
          />
        </label>

        <fieldset className="sm:col-span-2 m-0 border-0 p-0">
          <legend className="label-caps mb-2 p-0">Venue types</legend>
          {/* Checkboxes, not a single select: someone after live music will
              happily take a jazz club *and* a concert hall, and the old
              one-of-five control made them choose. */}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SEARCH_TYPES.map((c) => (
              <label key={c} className="flex items-center gap-2 cursor-pointer text-xs font-extrabold uppercase tracking-[0.5px]">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={types.includes(c)}
                  onChange={() => toggleType(c)}
                />
                {categoryLabel(c)}
              </label>
            ))}
          </div>
          <p className="mt-2 mb-0 text-xs text-muted">
            {types.length === 0 ? 'Nothing ticked — anything goes.' : 'Only these types are proposed.'}
          </p>
        </fieldset>

        <div className="sm:col-span-2">
          <span className="label-caps mb-2 block">Dates</span>
          <div className="act-row-sm mb-3">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={activePreset === p.key}
                onClick={() => applyPreset(p.key)}
                className={`act act-inherit ${activePreset === p.key ? 'act-on' : ''}`}
              >
                {p.label}
              </button>
            ))}
            {from || until ? (
              <button
                type="button"
                onClick={() => { setFrom(''); setUntil(''); }}
                className="act act-inherit"
              >
                Any dates
              </button>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label-caps mb-2">From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="field text-sm"
              />
            </label>
            <label className="block">
              <span className="label-caps mb-2">Until</span>
              <input
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                className="field text-sm"
              />
            </label>
          </div>
          {dateProblem ? (
            <p role="alert" className="mt-2 mb-0 text-xs font-bold text-accent">{dateProblem}</p>
          ) : null}
        </div>

        <label className="block">
          <span className="label-caps mb-2">Match against</span>
          {/* The folder is a taste signal, not the premise: it sharpens a
              search when you have one worth matching, and searching a city you
              have never been to is a perfectly good ask without it. */}
          <select
            value={matchAgainst}
            onChange={(e) => setMatchChoice(e.target.value)}
            className="select-flat w-full py-2 text-sm"
          >
            <option value="">Nothing — just the search</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label-caps mb-2">Destination</span>
          {/* Every folder here is one the user owns — this project has no
              curated system folders, so "Warsaw" is just the folder their
              account was seeded with and is as writable as any other. */}
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="select-flat w-full py-2 text-sm"
          >
            <option value="">New folder: {destinationLabel}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={!city.trim() || Boolean(dateProblem) || suggest.isPending}
            className="btn-fill"
          >
            {suggest.isPending ? 'Thinking…' : 'Propose'}
          </button>
        </div>
      </form>

      <p className="mt-3 mb-0 text-xs text-muted">
        Up to {VENUE_SUGGEST_MAX_CANDIDATES} venues, each checked for whether we can read its
        programme — and, when you give dates, for what it has on then. Nothing is created until
        you add something.
      </p>

      {suggest.error ? (
        <p role="alert" className="mt-4 text-sm font-bold text-accent">{suggest.error.message}</p>
      ) : null}

      {suggest.isSuccess && results.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          Nothing came back — try fewer venue types, a wider date range, or a bigger city.
        </p>
      ) : null}

      {results.length > 0 ? (
        <>
          <p className="mt-4 mb-0 text-xs text-muted">
            {matchFolder
              ? `Based on ${suggest.data?.basedOn} venue${suggest.data?.basedOn === 1 ? '' : 's'} in “${matchFolder.name}”. `
              : ''}
            A venue we can’t read is still addable — it keeps the reason.
            {hasWindow ? (
              <>
                {' '}
                <span data-testid="window-summary">
                  {withHits.length} of {results.length} had something in your dates in the listings
                  we sampled.
                </span>
              </>
            ) : null}
          </p>
          <ul className="mt-3 list-none m-0 p-0 border-t-2 border-ink">
            {results.map((s) => {
              const outcome = probes[s.url];
              const status = candidateStatus(outcome);
              const isAdded = added.includes(s.url);
              const dates = windowNote(outcome, searched.from, searched.until);
              const hasHits = eventsInWindow(outcome, searched.from, searched.until).length > 0;
              return (
                <li key={s.url} className="border-b-2 border-ink py-3 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-bold text-sm underline hover:text-accent"
                    >
                      {s.name}
                    </a>
                    <span className="text-muted text-xs"> · {s.city} · {categoryLabel(s.category)}</span>
                    <p className="mt-1 mb-0 text-xs text-muted">{s.why}</p>
                    <p
                      data-testid={`probe-${s.url}`}
                      className={`mt-1 mb-0 text-xs font-bold ${
                        status === 'ok'
                          ? 'text-ink'
                          : status === 'checking'
                            ? 'text-muted'
                            : 'text-accent'
                      }`}
                    >
                      {status === 'ok' ? '✓ ' : status === 'failed' ? '✗ ' : ''}
                      {candidateNote(outcome)}
                    </p>
                    {dates ? (
                      <p
                        data-testid={`dates-${s.url}`}
                        className={`mt-1 mb-0 text-xs ${hasHits ? 'font-bold text-ink' : 'text-muted'}`}
                      >
                        {dates}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={isAdded || add.isPending}
                    onClick={() =>
                      add.mutate({
                        name: s.name,
                        url: s.url,
                        city: s.city,
                        country: s.country,
                        category: s.category,
                        ...(destination
                          ? { listId: destination }
                          : { listName: city.trim() }),
                        probe: probeFacts(outcome),
                      })
                    }
                    className="btn-outline shrink-0 text-xs"
                  >
                    {isAdded ? 'Added' : 'Add'}
                  </button>
                </li>
              );
            })}
          </ul>
          {add.error ? (
            <p role="alert" className="mt-3 text-sm font-bold text-accent">
              Couldn&rsquo;t add it: {add.error.message}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
      ) : null}
    </>
  );
}

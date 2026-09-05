import { useState } from 'react';
import type { Category, ProbeOutcome, SourceMethod } from '@afisz/shared';
import { VENUE_SUGGEST_MAX_CANDIDATES, VENUE_SUGGEST_PROBE_CONCURRENCY } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { categoryLabel } from '../lib/format';
import { CATEGORIES } from './AddVenueForm';

/**
 * "Elsewhere" — venue discovery for a city you don't follow yet (GOI-92).
 *
 * Three things happen behind one button. A folder's venues go to the model as
 * taste exemplars and come back as candidates in the city you named; every
 * candidate is then run through the *existing* probe ladder, so what you see
 * beside each name is whether we could actually read its programme; and the
 * ones you tick are written into a destination folder, created on commit if
 * it doesn't exist yet.
 *
 * Two rules shape the rest of this file:
 *
 * - **Firecrawl is never run here.** A candidate that only a paid browser
 *   render could read is *flagged* as such and nothing is spent. Running it is
 *   a separate, per-venue decision on the venue's own row.
 * - **A failing probe does not delete the candidate.** A real venue with a bad
 *   website is still a real venue; it is addable with the reason attached, so
 *   the row later says why it isn't populating instead of just looking empty.
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

export function ElsewherePanel({ folders, activeFolderId, onAdded }: {
  folders: ElsewhereFolder[];
  /** The folder whose venues seed the search by default. */
  activeFolderId: string | null;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState('');
  const [type, setType] = useState<Category | ''>('');
  /**
   * Which folder's taste is being matched.
   *
   * The reader's choice, *resolved against the folders that actually exist* —
   * and the resolving is the fix (GOI-116). This was a plain `useState`
   * initialised to `activeFolderId ?? folders[0]?.id ?? ''`, which is read
   * once, on the first render. The panel's folders arrive from a query, so on
   * that first render there are none and the id is null: the state initialised
   * to `''` and, since a `useState` initialiser is ignored on every later
   * render, stayed `''` after the folders landed.
   *
   * The select then showed its first folder — a value of `''` matches no
   * option, so the browser displays the first one — while the state said
   * nothing was chosen, and `Propose` was disabled by a `!matchAgainst` the
   * reader had no way to satisfy. A complete-looking form with a dead button.
   */
  const [matchChoice, setMatchAgainst] = useState(activeFolderId ?? '');
  const matchAgainst =
    [matchChoice, activeFolderId].find((id) => id && folders.some((f) => f.id === id))
    ?? folders[0]?.id
    ?? '';
  /** '' means "the new city folder" — the default, and the only destination
   *  that doesn't exist yet. */
  const [destination, setDestination] = useState('');
  const [probes, setProbes] = useState<Record<string, ProbeOutcome>>({});
  const [added, setAdded] = useState<string[]>([]);

  const utils = trpc.useUtils();
  const suggest = trpc.my.venues.suggestSimilar.useMutation();
  const add = trpc.my.venues.add.useMutation({
    onSuccess: (_data, vars) => {
      setAdded((prev) => [...prev, vars.url]);
      onAdded();
    },
  });

  const matchFolder = folders.find((f) => f.id === matchAgainst);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = city.trim();
    if (!target || !matchAgainst) return;
    setAdded([]);
    setProbes({});
    let result;
    try {
      result = await suggest.mutateAsync({
        listId: matchAgainst,
        city: target,
        type: type ? categoryLabel(type) : undefined,
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

      <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block flex-1 min-w-[140px]">
          <span className="label-caps mb-2">City</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Berlin"
            className="field text-sm"
          />
        </label>

        <label className="block flex-1 min-w-[140px]">
          <span className="label-caps mb-2">Venue type</span>
          {/* The same category vocabulary the rest of the tab uses — this
              deliberately does not introduce a parallel list of "types". */}
          <select
            value={type}
            onChange={(e) => setType(e.target.value as Category | '')}
            className="select-flat w-full py-2 text-sm"
          >
            <option value="">Anything</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{categoryLabel(c)}</option>
            ))}
          </select>
        </label>

        <label className="block flex-1 min-w-[140px]">
          <span className="label-caps mb-2">Match against</span>
          {/* The folder is the taste signal, so which one is being matched
              can't be implicit — it defaults to the folder you're in and
              stays changeable. */}
          <select
            value={matchAgainst}
            onChange={(e) => setMatchAgainst(e.target.value)}
            className="select-flat w-full py-2 text-sm"
          >
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>

        <label className="block flex-1 min-w-[140px]">
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

        <button
          type="submit"
          disabled={!city.trim() || !matchAgainst || suggest.isPending}
          className="btn-fill"
        >
          {suggest.isPending ? 'Thinking…' : 'Propose'}
        </button>
      </form>

      {/* The one case where the button is legitimately dead: there is no
          folder to match against, so the search has no taste to work from.
          Said out loud rather than left to be inferred from a control that
          does nothing (GOI-116). */}
      {folders.length === 0 ? (
        <p className="mt-3 mb-0 text-xs font-bold text-accent">
          Add a venue to a folder first — the search works by matching what is already in one.
        </p>
      ) : (
        <p className="mt-3 mb-0 text-xs text-muted">
          Up to {VENUE_SUGGEST_MAX_CANDIDATES} venues, each checked for whether we can read its
          programme. Nothing is created until you add something.
        </p>
      )}

      {suggest.error ? (
        <p role="alert" className="mt-4 text-sm font-bold text-accent">{suggest.error.message}</p>
      ) : null}

      {suggest.isSuccess && results.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          Nothing came back for that city — try a broader type, or a bigger city.
        </p>
      ) : null}

      {results.length > 0 ? (
        <>
          <p className="mt-4 mb-0 text-xs text-muted">
            Based on {suggest.data?.basedOn} venue{suggest.data?.basedOn === 1 ? '' : 's'} in
            &ldquo;{matchFolder?.name}&rdquo;. A venue we can&rsquo;t read is still addable — it
            keeps the reason.
          </p>
          <ul className="mt-3 list-none m-0 p-0 border-t-2 border-ink">
            {results.map((s) => {
              const outcome = probes[s.url];
              const status = candidateStatus(outcome);
              const isAdded = added.includes(s.url);
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

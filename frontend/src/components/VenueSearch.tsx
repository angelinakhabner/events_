import { useState } from 'react';
import type { Event } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { formatEventTime, formatShortDate } from '../lib/format';
import { CategorySwatch } from './CategorySwatch';
import { EventActions } from './EventActions';
import { ErrorState, SkeletonList } from './states';

/**
 * Search a title across every venue (GOI-112).
 *
 * The list below this is the only thing on the page that could not be typed
 * into: an event reaches it through "Want to go" on a row you already found,
 * and a film through "Track film" in a screenings panel you could only open
 * from a screening. Both routes start from having found the thing — which is
 * no help at all when the question is "is this film on anywhere".
 *
 * So: a box, and the two answers it can give. When something is on, the rows
 * are ordinary event rows carrying their venue and their own actions, so
 * saving one is the button it always is. When nothing is, the title itself
 * goes on the list — that is the whole point of the feature, and the reason
 * the search sits here rather than over the public feed.
 *
 * Across every venue, not the reader's own: a film playing two streets away at
 * a cinema they have not added is a "yes", and reporting "no" because of the
 * follow list would be a worse answer than none.
 */
export function VenueSearch({ tracked, onTrack }: {
  /** Titles already on the list, lower-cased — so it never offers a duplicate. */
  tracked: string[];
  onTrack: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');

  const results = trpc.events.search.useQuery(
    { q: query },
    { enabled: query.length >= MIN_QUERY },
  );
  const track = trpc.my.films.add.useMutation({ onSuccess: onTrack });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (q.length < MIN_QUERY) return;
    setQuery(q);
    track.reset();
  };

  const searched = query.length >= MIN_QUERY;
  const found = results.data ?? [];
  const already = tracked.includes(query.toLowerCase());

  return (
    <section className="mb-8 border-3 border-ink p-5">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="block flex-1 min-w-[180px]">
          <span className="label-caps mb-2">Search across venues</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="A film, a play, a concert…"
            className="field text-sm"
          />
        </label>
        <button type="submit" disabled={draft.trim().length < MIN_QUERY} className="btn-fill">
          Search
        </button>
      </form>

      {!searched ? (
        <p className="mt-3 mb-0 text-xs text-muted">
          Looks at everything coming up at every venue we read — not only the ones you follow.
        </p>
      ) : null}

      {searched && results.isLoading ? <SkeletonList rows={2} /> : null}
      {searched && results.error ? (
        <ErrorState message="Couldn't search." onRetry={() => void results.refetch()} />
      ) : null}

      {searched && !results.isLoading && !results.error ? (
        found.length > 0 ? (
          <>
            <p className="mt-4 mb-0 text-xs font-bold uppercase tracking-[1px] text-muted">
              {found.length} coming up for “{query}”
            </p>
            <ul className="mt-2 border-t-3 border-ink list-none m-0 p-0">
              {found.map((event) => (
                <li key={event.id} className="rule-soft py-4">
                  <ResultRow event={event} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <NothingOn
            query={query}
            already={already}
            pending={track.isPending}
            done={track.isSuccess}
            error={track.error?.message ?? null}
            onTrack={() => track.mutate({ title: query })}
          />
        )
      ) : null}
    </section>
  );
}

/** Two characters is the shortest thing worth an ILIKE across every event. */
const MIN_QUERY = 2;

function ResultRow({ event }: { event: Event }) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
      <span className="pt-1 shrink-0"><CategorySwatch category={event.category} size={14} /></span>
      <div className="flex-1 min-w-0">
        <a href={event.sourceUrl} target="_blank" rel="noreferrer">
          <h3 className="m-0 text-[19px] font-bold leading-[1.15] text-ink hover:text-accent">
            {event.title}
          </h3>
        </a>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-bold uppercase tracking-[1px]">
          <span className="text-ink">{event.venue?.name ?? 'Unknown venue'}</span>
          <span className="text-muted">{formatShortDate(event.startsAt)}</span>
          <span className="text-muted">{formatEventTime(event)}</span>
        </div>
        <EventActions event={event} />
      </div>
    </div>
  );
}

/**
 * The answer the feature exists for.
 *
 * "Nothing found" is where a search normally stops being useful; here it is
 * the more useful of the two answers, because the title can go on the list and
 * the next sweep that turns it up will say so.
 */
function NothingOn({ query, already, pending, done, error, onTrack }: {
  query: string;
  already: boolean;
  pending: boolean;
  done: boolean;
  error: string | null;
  onTrack: () => void;
}) {
  return (
    <div className="mt-4 border-t-3 border-ink pt-4">
      <p className="m-0 text-sm text-body">
        Nothing coming up for <strong>“{query}”</strong> at any venue we read.
      </p>
      {already ? (
        <p className="mt-2 mb-0 text-sm font-bold text-ink">Already on your list.</p>
      ) : done ? (
        <p role="status" className="mt-2 mb-0 text-sm font-bold text-ink">
          Tracking “{query}” — it turns up here, and in your brief, as soon as it is announced.
        </p>
      ) : (
        <>
          <button type="button" onClick={onTrack} disabled={pending} className="act act-on mt-3">
            {pending ? 'Adding…' : `Track “${query}”`}
          </button>
          <p className="mt-2 mb-0 text-xs text-muted">
            We keep looking. When a venue announces it, it appears in this list with its dates.
          </p>
        </>
      )}
      {error ? <p role="alert" className="mt-2 mb-0 text-sm font-bold text-accent">{error}</p> : null}
    </div>
  );
}

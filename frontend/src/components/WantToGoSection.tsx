import { useMemo, useState } from 'react';
import type { Event, Film, WantToGoEntry } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { formatShortDate, formatTime } from '../lib/format';
import { ClosestScreenings } from './ClosestScreenings';
import { ErrorState, SkeletonList } from './states';

/**
 * /my → "Want to go" (GOI-26): one plain list rather than the day-grouped
 * event view — saved events and tracked films side by side, soonest first.
 *
 * Nothing is typed in here. Events arrive via the "Want to go" button on an
 * event, films via "Track film" in the live screenings panel. Anything on the
 * list can be marked seen, which moves it to the "Seen" tab instead of
 * dropping it.
 */
export function WantToGoSection() {
  const [tab, setTab] = useState<'want' | 'seen'>('want');
  const entries = trpc.my.wantToGo.entries.useQuery();
  const films = trpc.my.films.list.useQuery();

  const rows = useMemo(
    () => mergeRows(entries.data ?? [], films.data ?? []),
    [entries.data, films.data],
  );
  const want = rows.filter((r) => !r.seen);
  const seen = rows.filter((r) => r.seen);
  const shown = tab === 'want' ? want : seen;

  const loading = entries.isLoading || films.isLoading;
  const error = entries.error ?? films.error;

  return (
    <section>
      <h2 className="mb-2 font-serif text-2xl tracking-tight">Want to go</h2>
      <p className="mb-6 text-sm text-muted max-w-prose">
        Everything you saved, in one list. Add events with &ldquo;Want to go&rdquo; on any
        event, and films with &ldquo;Track film&rdquo; in the nearest-screenings panel.
      </p>

      <div className="mb-4 flex gap-2" role="tablist" aria-label="Want to go lists">
        <TabButton active={tab === 'want'} onClick={() => setTab('want')}>
          Want to go ({want.length})
        </TabButton>
        <TabButton active={tab === 'seen'} onClick={() => setTab('seen')}>
          Seen ({seen.length})
        </TabButton>
      </div>

      {loading ? <SkeletonList rows={2} /> : null}
      {error ? (
        <ErrorState
          message="Couldn't load your list."
          onRetry={() => { void entries.refetch(); void films.refetch(); }}
        />
      ) : null}

      {!loading && !error && shown.length === 0 ? (
        <p className="text-sm text-muted">
          {tab === 'want'
            ? 'Nothing saved yet — use “Want to go” on an event, or “Track film” in the nearest-screenings panel.'
            : 'Nothing marked seen yet.'}
        </p>
      ) : null}

      {shown.length > 0 ? (
        <ul className="divide-y divide-rule border-y border-rule list-none m-0 p-0">
          {shown.map((row) =>
            row.kind === 'event' ? (
              <EventRow key={row.key} entry={row.entry} />
            ) : (
              <FilmRow key={row.key} film={row.film} />
            ),
          )}
        </ul>
      ) : null}
    </section>
  );
}

// ─── Merging ─────────────────────────────────────────────────────────────────

type Row =
  | { kind: 'event'; key: string; seen: boolean; sortKey: string; entry: WantToGoEntry }
  | { kind: 'film'; key: string; seen: boolean; sortKey: string; film: Film };

/** Saved events and tracked films in one list, soonest first. Films have no
 *  date of their own, so they sort after the dated events. */
export function mergeRows(entries: WantToGoEntry[], films: Film[]): Row[] {
  const rows: Row[] = [
    ...entries.map((entry) => ({
      kind: 'event' as const,
      key: `event-${entry.event.id}`,
      seen: entry.seenAt !== null,
      sortKey: entry.event.startsAt,
      entry,
    })),
    ...films.map((film) => ({
      kind: 'film' as const,
      key: `film-${film.id}`,
      seen: film.status === 'seen',
      // '~' sorts after any ISO timestamp, parking undated films at the end.
      sortKey: `~${film.createdAt}`,
      film,
    })),
  ];
  return rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`text-sm border px-3 py-1.5 cursor-pointer bg-transparent ${
        active ? 'border-ink text-ink' : 'border-rule text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

function EventRow({ entry }: { entry: WantToGoEntry }) {
  const { event } = entry;
  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.my.wantToGo.entries.invalidate();
    utils.my.wantToGo.ids.invalidate();
    utils.my.wantToGo.list.invalidate();
  };
  const setSeen = trpc.my.wantToGo.setSeen.useMutation({ onSuccess: invalidate });
  const remove = trpc.my.wantToGo.remove.useMutation({ onSuccess: invalidate });
  const seen = entry.seenAt !== null;

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-4 py-3">
      <div className="min-w-0">
        <span className="tabular-nums text-sm text-muted">
          {formatShortDate(event.startsAt)} · {formatTime(event.startsAt)}
        </span>
        <a
          href={event.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-3 text-ink hover:text-accent no-underline"
        >
          {event.title}
        </a>
        {event.venue ? <span className="ml-3 text-sm text-muted">{event.venue.name}</span> : null}
      </div>
      <div className="flex shrink-0 items-baseline gap-4 text-sm">
        <button
          type="button"
          aria-pressed={seen}
          onClick={() => setSeen.mutate({ eventId: event.id, seen: !seen })}
          disabled={setSeen.isPending}
          className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50"
        >
          {seen ? 'Not seen' : 'Seen it'}
        </button>
        <button
          type="button"
          aria-label={`Remove ${event.title}`}
          onClick={() => remove.mutate({ eventId: event.id })}
          disabled={remove.isPending}
          className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

/** The screenings panel expects an Event; a film is only a title, so build the
 *  minimal stand-in it needs (title drives the query, category the wording). */
function filmAsEvent(film: Film): Event {
  return {
    id: `film-${film.id}`,
    venueId: '',
    title: film.title,
    description: null,
    startsAt: '',
    endsAt: null,
    category: 'cinema',
    language: null,
    director: null,
    cast: [],
    durationMinutes: null,
    priceMin: null,
    priceMax: null,
    sourceUrl: '',
    sourceId: null,
    scrapedAt: '',
  };
}

function FilmRow({ film }: { film: Film }) {
  const [marking, setMarking] = useState(false);
  const utils = trpc.useUtils();
  const invalidate = () => utils.my.films.list.invalidate();
  const moveToWant = trpc.my.films.moveToWant.useMutation({ onSuccess: invalidate });
  const remove = trpc.my.films.remove.useMutation({ onSuccess: invalidate });
  const seen = film.status === 'seen';

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="min-w-0">
          <span className="text-xs uppercase tracking-widest text-muted">film</span>
          <span className="ml-3 text-ink">{film.title}</span>
          {seen ? (
            <span className="ml-3 text-sm text-muted">
              {film.watchedVenue ? `at ${film.watchedVenue}` : null}
              {film.watchedVenue && film.watchedAt ? ' · ' : null}
              {film.watchedAt ? formatShortDate(film.watchedAt) : null}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-baseline gap-4 text-sm">
          {seen ? null : <ClosestScreenings event={filmAsEvent(film)} />}
          {seen ? (
            <button
              type="button"
              onClick={() => moveToWant.mutate({ filmId: film.id })}
              disabled={moveToWant.isPending}
              className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50"
            >
              Not seen
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMarking((v) => !v)}
              className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0"
            >
              Seen it
            </button>
          )}
          <button
            type="button"
            aria-label={`Remove ${film.title}`}
            onClick={() => remove.mutate({ filmId: film.id })}
            disabled={remove.isPending}
            className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>
      {film.comment ? <p className="mt-1 text-sm text-muted">{film.comment}</p> : null}
      {marking ? <MarkSeenForm film={film} onDone={() => setMarking(false)} /> : null}
    </li>
  );
}

function MarkSeenForm({ film, onDone }: { film: Film; onDone: () => void }) {
  const [venue, setVenue] = useState('');
  const [comment, setComment] = useState('');
  const utils = trpc.useUtils();
  const markSeen = trpc.my.films.markSeen.useMutation({
    onSuccess: async () => {
      await utils.my.films.list.invalidate();
      onDone();
    },
  });

  return (
    <form
      className="mt-3 flex flex-wrap gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        markSeen.mutate({
          filmId: film.id,
          watchedVenue: venue.trim() || undefined,
          comment: comment.trim() || undefined,
        });
      }}
    >
      <label className="sr-only" htmlFor={`seen-venue-${film.id}`}>Where did you watch it?</label>
      <input
        id={`seen-venue-${film.id}`}
        type="text"
        value={venue}
        onChange={(e) => setVenue(e.target.value)}
        placeholder="Where? e.g. Kino Muranów"
        className="border border-rule bg-paper px-3 py-2 text-sm"
      />
      <label className="sr-only" htmlFor={`seen-comment-${film.id}`}>Short comment</label>
      <input
        id={`seen-comment-${film.id}`}
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Short comment (optional)"
        className="flex-1 min-w-[10rem] border border-rule bg-paper px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={markSeen.isPending}
        className="link-accent text-sm bg-transparent border border-rule px-4 py-2 cursor-pointer disabled:opacity-50"
      >
        {markSeen.isPending ? 'Saving…' : 'Move to seen'}
      </button>
      {markSeen.error ? <p className="self-center text-sm text-muted">{markSeen.error.message}</p> : null}
    </form>
  );
}

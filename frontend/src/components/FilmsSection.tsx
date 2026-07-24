import { useState } from 'react';
import type { Event, Film } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { formatShortDate } from '../lib/format';
import { ClosestScreenings } from './ClosestScreenings';
import { ErrorState, SkeletonList } from './states';

/**
 * /my — "Films" (GOI-5): a personal list of titles split into "Want to watch"
 * and "Seen". Want-list rows reuse the "Nearest screenings" panel to show
 * where a title plays next; marking a film seen records where it was watched
 * plus a short note.
 */
export function FilmsSection() {
  const [tab, setTab] = useState<'want' | 'seen'>('want');
  const films = trpc.my.films.list.useQuery();

  const want = (films.data ?? []).filter((f) => f.status === 'want');
  const seen = (films.data ?? []).filter((f) => f.status === 'seen');
  const shown = tab === 'want' ? want : seen;

  return (
    <section>
      <h2 className="mb-6 font-serif text-2xl tracking-tight">Films</h2>

      <div className="mb-4 flex gap-2" role="tablist" aria-label="Film lists">
        <TabButton active={tab === 'want'} onClick={() => setTab('want')}>
          Want to watch ({want.length})
        </TabButton>
        <TabButton active={tab === 'seen'} onClick={() => setTab('seen')}>
          Seen ({seen.length})
        </TabButton>
      </div>

      {tab === 'want' ? <AddFilmForm /> : null}

      {films.isLoading ? <SkeletonList rows={2} /> : null}
      {films.error ? <ErrorState message="Couldn't load your films." onRetry={() => films.refetch()} /> : null}

      {films.data && shown.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {tab === 'want'
            ? 'No films yet — add a title you want to catch.'
            : 'Nothing here yet — mark a film as seen and it moves over.'}
        </p>
      ) : null}

      {shown.length > 0 ? (
        <ul className="mt-2 divide-y divide-rule list-none m-0 p-0">
          {shown.map((film) =>
            tab === 'want' ? <WantRow key={film.id} film={film} /> : <SeenRow key={film.id} film={film} />,
          )}
        </ul>
      ) : null}
    </section>
  );
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

function AddFilmForm() {
  const [title, setTitle] = useState('');
  const utils = trpc.useUtils();
  const add = trpc.my.films.add.useMutation({
    onSuccess: async () => {
      setTitle('');
      await utils.my.films.list.invalidate();
    },
  });

  return (
    <form
      className="mb-4 flex gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) add.mutate({ title: title.trim() });
      }}
    >
      <label className="sr-only" htmlFor="film-title">Film title</label>
      <input
        id="film-title"
        type="text"
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Film title, e.g. Perfect Days"
        className="flex-1 border border-rule bg-paper px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={add.isPending}
        className="link-accent text-sm bg-transparent border border-rule px-4 py-2 cursor-pointer disabled:opacity-50"
      >
        {add.isPending ? 'Adding…' : 'Add film'}
      </button>
      {add.error ? <p className="self-center text-sm text-muted">{add.error.message}</p> : null}
    </form>
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

function WantRow({ film }: { film: Film }) {
  const [marking, setMarking] = useState(false);
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium">{film.title}</span>
        <div className="flex items-baseline gap-4 text-sm shrink-0">
          <ClosestScreenings event={filmAsEvent(film)} />
          <button
            type="button"
            onClick={() => setMarking((v) => !v)}
            className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0"
          >
            Seen it
          </button>
          <RemoveButton filmId={film.id} title={film.title} />
        </div>
      </div>
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

function SeenRow({ film }: { film: Film }) {
  const utils = trpc.useUtils();
  const moveToWant = trpc.my.films.moveToWant.useMutation({
    onSuccess: () => utils.my.films.list.invalidate(),
  });

  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <span className="font-medium">{film.title}</span>
          <span className="ml-3 text-sm text-muted">
            {film.watchedVenue ? `at ${film.watchedVenue}` : null}
            {film.watchedVenue && film.watchedAt ? ' · ' : null}
            {film.watchedAt ? formatShortDate(film.watchedAt) : null}
          </span>
          {film.comment ? <p className="mt-1 text-sm text-muted">{film.comment}</p> : null}
        </div>
        <div className="flex items-baseline gap-4 text-sm shrink-0">
          <button
            type="button"
            onClick={() => moveToWant.mutate({ filmId: film.id })}
            disabled={moveToWant.isPending}
            className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50"
          >
            Back to want
          </button>
          <RemoveButton filmId={film.id} title={film.title} />
        </div>
      </div>
    </li>
  );
}

function RemoveButton({ filmId, title }: { filmId: string; title: string }) {
  const utils = trpc.useUtils();
  const remove = trpc.my.films.remove.useMutation({
    onSuccess: () => utils.my.films.list.invalidate(),
  });
  return (
    <button
      type="button"
      aria-label={`Remove ${title}`}
      onClick={() => remove.mutate({ filmId })}
      disabled={remove.isPending}
      className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50"
    >
      Remove
    </button>
  );
}

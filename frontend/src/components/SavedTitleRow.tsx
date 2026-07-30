import type { ReactNode } from 'react';
import type { Event, Film } from '@goin/shared';
import { ClosestScreenings } from './ClosestScreenings';

/**
 * One line of a "want to go" list: what it is, what it's called, and the
 * dates behind "Nearest screenings" (GOI-46). Deliberately carries no date of
 * its own — you save a title, not a showing.
 *
 * Shared by the owner's list on /my and the read-only shared view (GOI-47),
 * so a link you send someone renders exactly what you're looking at. The two
 * differ only in `actions`: "Seen it" / "Remove" belong to the owner.
 */
export function SavedTitleRow({
  event,
  meta,
  showScreenings = true,
  actions,
}: {
  event: Event;
  /** Small print after the title — e.g. where and when a film was watched. */
  meta?: ReactNode;
  showScreenings?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-4">
      <div className="min-w-0">
        <span className="text-xs uppercase tracking-widest text-muted">{kindLabel(event.category)}</span>
        {/* A tracked film has no page of its own — only real events do. */}
        {event.sourceUrl ? (
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-3 text-ink hover:text-accent no-underline"
          >
            {event.title}
          </a>
        ) : (
          <span className="ml-3 text-ink">{event.title}</span>
        )}
        {meta ? <span className="ml-3 text-sm text-muted">{meta}</span> : null}
      </div>
      <div className="flex shrink-0 items-baseline gap-4 text-sm">
        {showScreenings ? <ClosestScreenings event={event} includeSelf /> : null}
        {actions}
      </div>
    </div>
  );
}

/** The word stamped in front of a saved title. Films read as "FILM" rather
 *  than "CINEMA", which names the venue and not the thing you saved. */
export function kindLabel(category: string): string {
  return category === 'cinema' ? 'film' : category;
}

/** The screenings panel expects an Event; a film is only a title, so build the
 *  minimal stand-in it needs (title drives the query, category the wording).
 *  The empty `sourceUrl` is what makes the row render as plain text. */
export function filmAsEvent(film: Film): Event {
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

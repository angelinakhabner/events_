import type { ReactNode } from 'react';
import type { Event, Film } from '@afisz/shared';
import { CategorySwatch } from './CategorySwatch';
import { ScreeningsStrip } from './ScreeningsStrip';

/**
 * One line of a "want to go" list: what it is, what it's called, and where and
 * when you can go (GOI-46). Deliberately carries no date of its own — you save
 * a title, not a showing — so the screenings strip is where its dates live.
 *
 * On the owner's own list that strip starts open (GOI-66): a saved film is a
 * question about where it is playing, and answering it took a click on every
 * row.
 *
 * Shared by the owner's list on /my and the read-only shared view (GOI-47),
 * so a link you send someone renders exactly what you're looking at. The two
 * differ only in `actions`: "Seen it" / "Remove" belong to the owner.
 *
 * The category swatch does the work the uppercase word used to do alone — you
 * can tell a film from a play down the left edge without reading — and the
 * word stays under the title for anyone who can't see the shape.
 */
export function SavedTitleRow({
  event,
  meta,
  showScreenings = true,
  screeningsOpen = false,
  actions,
}: {
  event: Event;
  /** Small print after the title — e.g. where and when a film was watched. */
  meta?: ReactNode;
  showScreenings?: boolean;
  /** Show the times without asking (GOI-66) — see the strip's `defaultOpen`. */
  screeningsOpen?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-4">
      <CategorySwatch category={event.category} size={16} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <h4 className="m-0 text-lg md:text-[21px] font-bold leading-[1.2]">
          {/* A tracked film has no page of its own — only real events do. */}
          {event.sourceUrl ? (
            <a href={event.sourceUrl} target="_blank" rel="noreferrer" className="text-ink hover:text-accent">
              {event.title}
            </a>
          ) : (
            <span className="text-ink">{event.title}</span>
          )}
        </h4>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 tag">
          <span>{kindLabel(event.category)}</span>
          {meta ? (
            <span className="normal-case tracking-normal font-medium text-faint">{meta}</span>
          ) : null}
        </div>
        <div className="act-row-sm mt-3">
          {showScreenings ? <ScreeningsStrip event={event} defaultOpen={screeningsOpen} /> : null}
          {actions}
        </div>
      </div>
    </div>
  );
}

/** The word stamped in front of a saved title. Films read as "FILM" rather
 *  than "CINEMA", which names the venue and not the thing you saved. */
export function kindLabel(category: string): string {
  return category === 'cinema' ? 'film' : category;
}

/** The screenings strip expects an Event; a film is only a title, so build the
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

import { useEffect, useRef, useState } from 'react';
import type { Event } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { formatShortDate, formatTime } from '../lib/format';

/** Cap on venue rows in the panel, soonest venues first. */
const MAX_SHOWN = 6;

/** "Screenings" for films; plays/concerts/exhibitions get the generic word. */
function panelLabel(event: Event): string {
  return event.category === 'cinema' ? 'Nearest screenings' : 'Nearest dates';
}

/**
 * "Nearest screenings" (films) / "Nearest dates" (everything else) — opens a
 * dropdown with one row per venue showing that venue's soonest upcoming
 * showing of the same title, soonest venue first. Grouping by venue (rather
 * than listing showings chronologically) keeps every cinema visible even when
 * one of them screens the film many times a day.
 *
 * The panel (and its query) only mounts once opened, so cards don't fire a
 * request per event and the button stays safe to render outside a tRPC
 * provider in unit tests.
 */
export function ClosestScreenings({ event }: { event: Event }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape so the inline panel doesn't get stuck open.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0"
      >
        {panelLabel(event)}
      </button>
      {open ? <ScreeningsPanel event={event} /> : null}
    </div>
  );
}

interface VenueGroup {
  key: string;
  venueName: string;
  /** Soonest upcoming showing at this venue. */
  next: Event;
  /** Further showings at the same venue beyond `next`. */
  moreCount: number;
}

/** One group per venue, keeping only each venue's soonest showing. Relies on
 *  the API's soonest-first ordering, so the first hit per venue is its next
 *  showing and groups come out sorted by that time. */
function groupByVenue(screenings: Event[]): VenueGroup[] {
  const groups: VenueGroup[] = [];
  const byKey = new Map<string, VenueGroup>();
  for (const s of screenings) {
    const key = s.venue?.id ?? s.venueId;
    const existing = byKey.get(key);
    if (existing) {
      existing.moreCount += 1;
    } else {
      const group = { key, venueName: s.venue?.name ?? 'Unknown venue', next: s, moreCount: 0 };
      byKey.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}

function ScreeningsPanel({ event }: { event: Event }) {
  const screenings = trpc.events.screenings.useQuery({ title: event.title });
  // The showing you clicked from is already on screen — group the
  // alternatives (including later showings at the same venue) per venue.
  const others = (screenings.data ?? []).filter((s) => s.id !== event.id);
  const venues = groupByVenue(others).slice(0, MAX_SHOWN);

  const isFilm = event.category === 'cinema';
  let body;
  if (screenings.isLoading) {
    body = <div className="text-sm text-muted">{isFilm ? 'Looking for screenings…' : 'Looking for dates…'}</div>;
  } else if (screenings.isError) {
    body = <div className="text-sm text-muted">{isFilm ? 'Couldn’t load screenings.' : 'Couldn’t load dates.'}</div>;
  } else if (venues.length === 0) {
    body = <div className="text-sm text-muted">{isFilm ? 'No other upcoming screenings.' : 'No other upcoming dates.'}</div>;
  } else {
    body = (
      <ul className="divide-y divide-rule list-none m-0 p-0">
        {venues.map((g) => (
          <li key={g.key}>
            <a
              href={g.next.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-baseline gap-3 py-1.5 text-sm text-ink hover:text-accent no-underline"
            >
              <span className="shrink-0 tabular-nums text-muted">
                {formatShortDate(g.next.startsAt)} · {formatTime(g.next.startsAt)}
              </span>
              <span className="truncate">{g.venueName}</span>
              {g.moreCount > 0 ? (
                <span className="shrink-0 text-xs text-muted">+{g.moreCount} more</span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="absolute z-10 left-0 mt-2 bg-paper border border-rule p-3 min-w-[16rem] max-w-[22rem]">
      <div className="text-xs uppercase tracking-wide text-muted mb-2">{panelLabel(event)}</div>
      {body}
    </div>
  );
}

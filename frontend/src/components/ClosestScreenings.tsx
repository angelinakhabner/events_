import { useEffect, useRef, useState } from 'react';
import type { Event } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { isLoggedIn } from '../lib/auth';
import { formatDayKey, formatShortDate, formatTime } from '../lib/format';

/** Days shown before "See more" — today and tomorrow, as in the mock. */
const DAYS_SHOWN = 2;
/** Ceiling once expanded, so a long-running title can't grow the panel forever. */
const MAX_DAYS = 14;
/** Per-day caps: enough for a full cinema programme, short of a wall of times. */
const MAX_VENUES_PER_DAY = 8;
const MAX_TIMES_PER_VENUE = 8;

/** "Screenings" for films; plays/concerts/exhibitions get the generic word. */
function panelLabel(event: Event): string {
  return event.category === 'cinema' ? 'Nearest screenings' : 'Nearest dates';
}

/**
 * "Nearest screenings" (films) / "Nearest dates" (everything else) — opens a
 * dropdown laid out day by day, one row per venue showing that venue's times
 * for the day (GOI-46):
 *
 *     TODAY
 *     KINOTEKA 14:00 18:00      KINO MURANÓW 18:00 21:00
 *
 * Grouping by day and then by venue is what makes the panel readable when the
 * same title runs at four cinemas: you scan the day you're free, then pick a
 * place and a time. Each time links to that specific showing.
 *
 * The panel (and its query) only mounts once opened, so cards don't fire a
 * request per event and the button stays safe to render outside a tRPC
 * provider in unit tests.
 *
 * `includeSelf` keeps the passed event in the list. Event cards leave it off —
 * the showing you clicked from is already on screen right above the panel —
 * while the want-to-go list turns it on, because there its rows carry no date
 * or time of their own and the panel is the only place times appear.
 */
export function ClosestScreenings({
  event,
  includeSelf = false,
}: {
  event: Event;
  includeSelf?: boolean;
}) {
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
      {open ? <ScreeningsPanel event={event} includeSelf={includeSelf} /> : null}
    </div>
  );
}

// ─── Grouping ────────────────────────────────────────────────────────────────

/** One venue's showings within a single day, in time order. */
export interface VenueTimes {
  key: string;
  venueName: string;
  showings: Event[];
}

/** One Warsaw day's worth of showings, grouped by venue. */
export interface ScreeningDay {
  /** Warsaw calendar day, `YYYY-MM-DD`. */
  dayKey: string;
  label: string;
  venues: VenueTimes[];
}

/** The Warsaw day after `key`, by calendar arithmetic rather than "+24h" — an
 *  hours-based step lands on the wrong day across a DST change. */
function nextDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

/**
 * Screenings → days → venues → times, preserving the API's soonest-first
 * order at every level, so days come out chronological, venues within a day
 * are ordered by their first showing, and times run up the day.
 */
export function groupByDay(screenings: Event[], now: Date = new Date()): ScreeningDay[] {
  const today = formatDayKey(now.toISOString());
  const tomorrow = nextDayKey(today);

  const days: ScreeningDay[] = [];
  const byDay = new Map<string, ScreeningDay>();
  const byDayVenue = new Map<string, VenueTimes>();

  for (const s of screenings) {
    const dayKey = formatDayKey(s.startsAt);
    let day = byDay.get(dayKey);
    if (!day) {
      const label =
        dayKey === today ? 'Today' :
        dayKey === tomorrow ? 'Tomorrow' :
        formatShortDate(s.startsAt);
      day = { dayKey, label, venues: [] };
      byDay.set(dayKey, day);
      days.push(day);
    }

    const venueKey = s.venue?.id ?? s.venueId;
    const groupKey = `${dayKey}|${venueKey}`;
    let group = byDayVenue.get(groupKey);
    if (!group) {
      group = { key: groupKey, venueName: s.venue?.name ?? 'Unknown venue', showings: [] };
      byDayVenue.set(groupKey, group);
      day.venues.push(group);
    }
    group.showings.push(s);
  }

  for (const day of days) {
    day.venues = day.venues.slice(0, MAX_VENUES_PER_DAY);
    for (const v of day.venues) v.showings = v.showings.slice(0, MAX_TIMES_PER_VENUE);
  }
  return days.slice(0, MAX_DAYS);
}

// ─── Panel ───────────────────────────────────────────────────────────────────

function ScreeningsPanel({ event, includeSelf }: { event: Event; includeSelf: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const screenings = trpc.events.screenings.useQuery(
    { title: event.title },
    // Fail fast: with react-query's default 3 retries a dead endpoint keeps
    // the panel stuck on "Looking for…" for ~10s before the error shows.
    { retry: 1 },
  );
  const shown = includeSelf
    ? (screenings.data ?? [])
    : (screenings.data ?? []).filter((s) => s.id !== event.id);
  const days = groupByDay(shown);
  const visible = expanded ? days : days.slice(0, DAYS_SHOWN);

  const isFilm = event.category === 'cinema';
  let body;
  if (screenings.isLoading) {
    body = <div className="text-sm text-muted">{isFilm ? 'Looking for screenings…' : 'Looking for dates…'}</div>;
  } else if (screenings.isError) {
    body = <div className="text-sm text-muted">{isFilm ? 'Couldn’t load screenings.' : 'Couldn’t load dates.'}</div>;
  } else if (days.length === 0) {
    const nothing = includeSelf ? 'No upcoming' : 'No other upcoming';
    body = <div className="text-sm text-muted">{nothing} {isFilm ? 'screenings.' : 'dates.'}</div>;
  } else {
    body = (
      <>
        <ul className="list-none m-0 p-0">
          {visible.map((day) => (
            <li key={day.dayKey} className="mb-3 last:mb-0">
              <div className="text-xs uppercase tracking-widest text-muted">{day.label}</div>
              <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
                {day.venues.map((v) => (
                  <div key={v.key} className="flex items-baseline gap-2">
                    <span className="text-xs uppercase tracking-wide text-muted">{v.venueName}</span>
                    {v.showings.map((s) => (
                      <a
                        key={s.id}
                        href={s.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="tabular-nums text-sm text-ink hover:text-accent no-underline"
                      >
                        {formatTime(s.startsAt)}
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {!expanded && days.length > DAYS_SHOWN ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-1 text-xs uppercase tracking-widest text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0"
          >
            See more
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div className="absolute z-10 left-0 mt-2 bg-paper border border-rule p-3 min-w-[18rem] max-w-[32rem]">
      <div className="text-xs uppercase tracking-wide text-muted mb-2">{panelLabel(event)}</div>
      {body}
      {isFilm && isLoggedIn() ? <TrackFilmButton title={event.title} /> : null}
    </div>
  );
}

/**
 * "Track film" (GOI-26): the only way a film reaches your "want to go" list —
 * there is no free-text field anywhere, so a tracked title always comes from a
 * real screening and matches how the venue spells it.
 */
function TrackFilmButton({ title }: { title: string }) {
  const utils = trpc.useUtils();
  const films = trpc.my.films.list.useQuery();
  const add = trpc.my.films.add.useMutation({
    onSuccess: () => utils.my.films.list.invalidate(),
  });

  const tracked =
    add.isSuccess || (films.data ?? []).some((f) => f.title.toLowerCase() === title.toLowerCase());

  return (
    <div className="mt-3 border-t border-rule pt-2">
      <button
        type="button"
        disabled={tracked || add.isPending}
        onClick={() => add.mutate({ title })}
        className="text-sm link-accent bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50 disabled:cursor-default"
      >
        {tracked ? '✓ On your want-to-go list' : add.isPending ? 'Adding…' : '+ Track film'}
      </button>
      {add.error && !tracked ? (
        <p className="mt-1 text-xs text-muted">{add.error.message}</p>
      ) : null}
    </div>
  );
}

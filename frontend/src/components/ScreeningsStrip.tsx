import { useState } from 'react';
import type { Event } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { formatDayKey, formatShortDate, formatTime } from '../lib/format';
import { AddToCalendar } from './AddToCalendar';

/** Ticket blocks shown before the strip caps itself with a "+N". */
const BLOCKS = 3;

/** "Screenings" for films; plays/concerts/exhibitions get the generic word. */
function label(event: Event, open: boolean): string {
  if (open) return event.category === 'cinema' ? 'Hide screenings' : 'Hide dates';
  return event.category === 'cinema' ? 'Nearest screenings' : 'Nearest dates';
}

/**
 * The want-to-go list's dates, as a row of ticket stubs (GOI-46 by way of the
 * poster redesign): the soonest showing inverted to white-on-ink, up to two
 * more on paper beside it, and a red "+N" cap when there are others.
 *
 * A saved entry carries no date of its own — you save a *title*, not the 18:00
 * showing you happened to be looking at — so this strip is the only place its
 * times appear, which is why it opens inline under the row rather than as a
 * dropdown that covers the next entry.
 *
 * The "+N" cap is the control that reveals the rest, so the extra dates are
 * never a dead end.
 */
export function ScreeningsStrip({ event }: { event: Event }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`act act-sm md:text-xs ${open ? 'act-on' : ''}`}
      >
        {label(event, open)}
      </button>
      {open ? <Strip event={event} /> : null}
    </div>
  );
}

function Strip({ event }: { event: Event }) {
  const [showAll, setShowAll] = useState(false);
  const screenings = trpc.events.screenings.useQuery(
    { title: event.title },
    // Fail fast: with react-query's default 3 retries a dead endpoint keeps
    // the strip stuck on "Looking for…" for ~10s before the error shows.
    { retry: 1 },
  );

  const isFilm = event.category === 'cinema';
  const all = screenings.data ?? [];

  if (screenings.isLoading) {
    return <Note>{isFilm ? 'Looking for screenings…' : 'Looking for dates…'}</Note>;
  }
  if (screenings.isError) {
    return <Note>{isFilm ? 'Couldn’t load screenings.' : 'Couldn’t load dates.'}</Note>;
  }
  if (all.length === 0) {
    return <Note>{isFilm ? 'No upcoming screenings.' : 'No upcoming dates.'}</Note>;
  }

  const shown = showAll ? all : all.slice(0, BLOCKS);
  const extra = all.length - shown.length;

  return (
    <div className="mt-4 flex w-fit max-w-full overflow-x-auto border-3 border-ink">
      {shown.map((s, i) => (
        <Ticket key={s.id} screening={s} inverted={i === 0} />
      ))}
      {extra > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          aria-label={`Show ${extra} more ${isFilm ? 'screenings' : 'dates'}`}
          className="w-11 md:w-14 shrink-0 bg-accent text-white text-[11px] md:text-xs font-extrabold cursor-pointer border-0"
        >
          +{extra}
        </button>
      ) : null}
    </div>
  );
}

/** One stub: the day it falls on, the time in display type, and where. */
function Ticket({ screening, inverted }: { screening: Event; inverted: boolean }) {
  return (
    <div
      className={`shrink-0 border-r-2 border-ink px-3.5 py-2.5 md:px-4 md:py-3 ${
        inverted ? 'bg-ink text-white' : 'bg-transparent text-ink'
      }`}
    >
      <div
        className={`text-[9px] md:text-[10px] font-extrabold uppercase tracking-[1px] ${
          inverted ? 'text-[#c9c4bc]' : 'text-faint'
        }`}
      >
        {dayLabel(screening.startsAt)}
      </div>
      {/* The time links to the showing's own page (where you buy the ticket);
          the glyph beside it books that exact venue-and-time (GOI-48). */}
      <div className="my-0.5 flex items-baseline gap-1.5">
        <a
          href={screening.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={`font-display text-base md:text-lg ${
            inverted ? 'text-white hover:text-[#c9c4bc]' : 'text-ink hover:text-accent'
          }`}
        >
          {formatTime(screening.startsAt)}
        </a>
        <AddToCalendar event={screening} variant="icon" />
      </div>
      <div className="text-[10px] md:text-[11px] font-bold">
        {screening.venue?.name ?? 'Unknown venue'}
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-2.5 text-sm text-muted">{children}</p>;
}

/** "TODAY" / "TOMORROW" while they mean something, a date after that. */
function dayLabel(iso: string, now: Date = new Date()): string {
  const day = formatDayKey(iso);
  const today = formatDayKey(now.toISOString());
  if (day === today) return 'Today';
  // Calendar arithmetic rather than "+24h": an hours-based step lands on the
  // wrong day across a DST change.
  const [y, m, d] = today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
  if (day === tomorrow) return 'Tomorrow';
  return formatShortDate(iso);
}

import { useState } from 'react';
import type { Event } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { isLoggedIn } from '../lib/auth';
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
 * Every "nearest screenings" in the app, as a row of ticket stubs (GOI-46 by
 * way of the poster redesign): the soonest showing inverted to white-on-ink,
 * up to two more on paper beside it, and a red "+N" cap when there are others.
 *
 * This started as the want-to-go list's own presentation while the home page
 * kept a day-by-day dropdown. Two components rendering one query in two shapes
 * is how they drifted, and the home page came off worse (GOI-55) — so the
 * strip is now the single answer and the dropdown is gone.
 *
 * It opens *inline under* the row rather than as an overlay: a saved entry
 * carries no date of its own — you save a *title*, not the 18:00 showing you
 * happened to be looking at — so this is the only place its times appear, and
 * it must not cover the next entry to show them.
 *
 * The "+N" cap is the control that reveals the rest, so the extra dates are
 * never a dead end.
 *
 * `includeSelf` keeps the passed event among the stubs. The want-to-go list
 * leaves it on (its rows have no time of their own); event cards turn it off,
 * because the showing you are reading is printed directly above the strip.
 *
 * `canTrack` shows the "Track film" row — the only way a film reaches a
 * want-to-go list (GOI-26). Off where the film is already on the list.
 */
export function ScreeningsStrip({
  event,
  includeSelf = true,
  canTrack = false,
  defaultOpen = false,
}: {
  event: Event;
  includeSelf?: boolean;
  canTrack?: boolean;
  /** Start expanded. The want-to-go list does (GOI-66): a saved row carries no
   *  date of its own, so with the strip shut it says only the title — and the
   *  question you have about a film you saved is *where and when*, which was
   *  one click away on every row instead of simply on screen. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        // Size comes from the action row, so this button and the ones beside
        // it share a line box (GOI-63).
        className={`act act-inherit ${open ? 'act-on' : ''}`}
      >
        {label(event, open)}
      </button>
      {open ? <Strip event={event} includeSelf={includeSelf} canTrack={canTrack} /> : null}
    </div>
  );
}

function Strip({
  event,
  includeSelf,
  canTrack,
}: {
  event: Event;
  includeSelf: boolean;
  canTrack: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const screenings = trpc.events.screenings.useQuery(
    { title: event.title },
    // Fail fast: with react-query's default 3 retries a dead endpoint keeps
    // the strip stuck on "Looking for…" for ~10s before the error shows.
    { retry: 1 },
  );

  const isFilm = event.category === 'cinema';
  const all = includeSelf
    ? (screenings.data ?? [])
    : (screenings.data ?? []).filter((s) => s.id !== event.id);

  // The track row belongs to the title, not to the times, so it stays put
  // whether or not there is anything to show above it.
  const track = isFilm && canTrack && isLoggedIn() ? <TrackFilmButton title={event.title} /> : null;

  if (screenings.isLoading) {
    return <Note>{isFilm ? 'Looking for screenings…' : 'Looking for dates…'}</Note>;
  }
  if (screenings.isError) {
    return <Note>{isFilm ? 'Couldn’t load screenings.' : 'Couldn’t load dates.'}</Note>;
  }
  if (all.length === 0) {
    const nothing = includeSelf ? 'No upcoming' : 'No other upcoming';
    return (
      <>
        <Note>{nothing} {isFilm ? 'screenings.' : 'dates.'}</Note>
        {track}
      </>
    );
  }

  const shown = showAll ? all : all.slice(0, BLOCKS);
  const extra = all.length - shown.length;

  return (
    <>
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
      {track}
    </>
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
    <div className="mt-3">
      <button
        type="button"
        disabled={tracked || add.isPending}
        onClick={() => add.mutate({ title })}
        className="act act-sm act-on"
      >
        {tracked ? '✓ On your want-to-go list' : add.isPending ? 'Adding…' : '+ Track film'}
      </button>
      {add.error && !tracked ? (
        <p className="mt-1 text-[11px] text-muted">{add.error.message}</p>
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

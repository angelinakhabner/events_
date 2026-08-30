import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Category, Event } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import {
  dayFilterRange, filterEventsByDay, filterEventsFrom, filterEventsFromHour, nextEventStart,
  visibleEvents, type DayFilter,
} from '../lib/buckets';
import { dayFilterPhrase } from '../lib/format';
import {
  parseSlugParam, selectionFor, selectionToSlugs, slugsToSelection, withSelection,
  type VenueSelection,
} from '../lib/venue-selection';
import { EventBuckets } from '../components/EventBuckets';
import { CategoryBar } from '../components/CategoryBar';
import { DayBar } from '../components/DayBar';
import { TimeBar } from '../components/TimeBar';
import { VenueBar } from '../components/VenueBar';
import { isLoggedIn } from '../lib/auth';
import { EmptyState, ErrorState, NextUpNotice, SkeletonList } from '../components/states';
import { FestivalsSection } from '../components/FestivalsSection';
import { FestivalBanner } from '../components/FestivalBanner';

const REFETCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The venue selection in the URL (GOI-76 §5), read and written through the
 * History API rather than react-router's `useSearchParams`.
 *
 * `useSearchParams` throws outside a `<Router>`, which would make every test
 * that renders this page — several of which predate the filter row and are
 * about something else entirely — need a router wrapper to exercise code they
 * don't care about. The selection is local state, so nothing here needs to
 * subscribe to location changes; it only needs to read once and write on
 * change. `replaceState` keeps the back button meaning "the previous page",
 * not "the previous chip I clicked".
 */
function readVenueParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('venues');
}

function writeVenueParam(slugs: string[]): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (slugs.length > 0) params.set('venues', slugs.join(','));
  else params.delete('venues');
  const query = params.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  );
}

export function HomePage() {
  const [category, setCategory] = useState<Category | null>(null);
  const [day, setDay] = useState<DayFilter>(null);
  const [fromHour, setFromHour] = useState<number | null>(null);

  const [venueSelection, setVenueSelection] = useState<VenueSelection>({});

  // The day strip's selection as a Warsaw day window. Recomputed only when the
  // selection changes, so it stays referentially stable as a query key.
  const range = useMemo(() => dayFilterRange(day), [day]);

  /**
   * The listing, starting at the selected day rather than at now (GOI-88).
   *
   * One query answers both halves of the day filter. The rows come back in
   * start order from `fromDay`, so the selected window's events are at the
   * head — the server's limit can't hide them the way filtering the nearest
   * hundred rows in the browser did — and everything after them is exactly the
   * "nearest events" the notice shows when that window turns out to be empty.
   */
  const eventsQuery = trpc.events.listDefault.useQuery(
    {
      ...(category ? { filters: { categories: [category] } } : {}),
      ...(range ? { fromDay: range.fromDay } : {}),
    },
    { refetchInterval: REFETCH_INTERVAL_MS, refetchOnWindowFocus: true },
  );
  const venuesQuery = trpc.venues.list.useQuery();

  // The chips (GOI-76). Keyed on category/day/hour only — never on the
  // selection, so picking a venue re-renders from cache instead of refetching
  // counts that by definition didn't change.
  const filterOptionsQuery = trpc.events.filterOptions.useQuery(
    { category: category ?? undefined, range: range ?? undefined, fromHour: fromHour ?? undefined },
    { enabled: category !== null },
  );
  const venueOptions = useMemo(
    () => filterOptionsQuery.data?.venues ?? [],
    [filterOptionsQuery.data],
  );
  const selectedVenues = selectionFor(venueSelection, category);

  // Restore a linked selection once the venues it names are known. Runs only
  // while nothing is selected, so it can't fight the user's own clicks.
  useEffect(() => {
    if (venueOptions.length === 0 || selectedVenues.length > 0) return;
    const slugs = parseSlugParam(readVenueParam());
    if (slugs.length === 0) return;
    const ids = slugsToSelection(slugs, venueOptions);
    if (ids.length > 0) setVenueSelection((prev) => withSelection(prev, category, ids));
  }, [venueOptions, category, selectedVenues.length]);

  const changeVenues = (ids: string[]) => {
    setVenueSelection((prev) => withSelection(prev, category, ids));
    writeVenueParam(selectionToSlugs(ids, venueOptions));
  };

  const venueMap = useMemo(
    () => new Map((venuesQuery.data ?? []).map((v) => [v.id, v])),
    [venuesQuery.data],
  );

  // The filters that aren't the day: they apply to the selected window and to
  // the fallback listing alike, so the nearest events shown under "next event
  // on…" are still the reader's own category, hour and venues.
  const applyRest = useCallback(
    (rows: Event[]) => {
      const byTime = filterEventsFromHour(visibleEvents(rows), fromHour);
      if (selectedVenues.length === 0) return byTime;
      const wanted = new Set(selectedVenues);
      return byTime.filter((e) => wanted.has(e.venueId));
    },
    [fromHour, selectedVenues],
  );

  /** Everything from the selected day onward — the fallback listing. The
   *  server already starts there; re-applying the cut keeps a stale cached
   *  page from answering a Thursday with Tuesday's rows. */
  const nearest = useMemo(() => {
    const rows = eventsQuery.data ?? [];
    return applyRest(range ? filterEventsFrom(rows, range.fromDay) : rows);
  }, [applyRest, range, eventsQuery.data]);
  /** What the day strip actually asked for. */
  const selected = useMemo(
    () => (range ? filterEventsByDay(nearest, day) : nearest),
    [nearest, range, day],
  );

  // Nothing in the chosen window, but something on after it: name the date and
  // show that, instead of a dead end the reader can only escape by guessing
  // days (GOI-88).
  const fallback = range !== null && selected.length === 0 && nearest.length > 0;
  const events = fallback ? nearest : selected;

  // GOI-99: the banner asks for every festival, not the selected listing's —
  // it sits above the category bar, so narrowing it to the current tab would
  // make it appear and vanish as the reader clicks around above it.
  const allFestivals = trpc.festivals.list.useQuery(undefined);

  return (
    <section>
      <Hero />

      {/* Above the filters and directly under the masthead, because a festival
          in the next fortnight is context for the whole listing rather than a
          row in it (GOI-99). */}
      <FestivalBanner festivals={allFestivals.data} />

      <div className="page-x">
        <CategoryBar selected={category} onChange={setCategory} />
        <DayBar selected={day} onChange={setDay} />
        <TimeBar selected={fromHour} onChange={setFromHour} />
        <VenueBar
          venues={venueOptions}
          selected={selectedVenues}
          onChange={changeVenues}
          category={category}
          loading={filterOptionsQuery.isLoading}
          signedIn={isLoggedIn()}
        />

        <div className="mt-8">
          {eventsQuery.isLoading ? <SkeletonList /> : null}
          {eventsQuery.error ? (
            <ErrorState
              message="Couldn't load events."
              onRetry={() => eventsQuery.refetch()}
            />
          ) : null}
          {!eventsQuery.isLoading && !eventsQuery.error && events.length === 0 ? (
            <EmptyState
              title={
                category || day || fromHour !== null || selectedVenues.length > 0
                  ? 'No upcoming events match your selection.'
                  : 'No upcoming events.'
              }
              action={
                category || day || fromHour !== null || selectedVenues.length > 0
                  ? {
                      label: 'Show all',
                      onClick: () => {
                        setCategory(null);
                        setDay(null);
                        setFromHour(null);
                        changeVenues([]);
                      },
                    }
                  : undefined
              }
            />
          ) : null}
          {fallback ? (
            <NextUpNotice scope={dayFilterPhrase(day)} nextIso={nextEventStart(nearest)} />
          ) : null}
          {events.length > 0 ? <EventBuckets events={events} venues={venueMap} /> : null}
        </div>

        {/* "Coming soon" sits at the foot of the listing it belongs to, so a
            category's festivals arrive with its events rather than as cinema
            news pinned to every page (GOI-68). */}
        <FestivalsSection category={category} />
      </div>
    </section>
  );
}

/**
 * The full-bleed black band: "CO SIĘ DZIEJE" — Polish for "what's going on" —
 * stacked in Anton, with the middle line in red and the last one drawn as an
 * outline. It is the app's only piece of poster-scale type, and it is Polish
 * on purpose: the wordmark and this headline are the brand, the rest of the
 * interface stays in English.
 */
function Hero() {
  return (
    <div className="bg-ink text-white page-x pt-10 pb-9 md:pt-16 md:pb-14">
      <div className="max-w-[900px]">
        <h1
          className="font-display leading-[0.94] tracking-[0.5px] md:tracking-[1px] m-0"
          style={{ fontSize: 'clamp(44px, 9vw, 110px)' }}
        >
          <span className="block">CO</span>
          <span className="block text-accent">SIĘ</span>
          {/* Stroked in its own colour: the letterforms thicken rather than
              hollow out, which is what gives the third line its weight. */}
          <span className="block" style={{ WebkitTextStroke: '3px #fff' }}>
            DZIEJE
          </span>
        </h1>
        <p className="mt-4 md:mt-6 max-w-[520px] text-sm md:text-lg font-medium text-[#c9c4bc]">
          Cinema, theatre, comedy, music and museums across Warsaw — one listing,
          refreshed every few minutes.
        </p>
      </div>
    </div>
  );
}

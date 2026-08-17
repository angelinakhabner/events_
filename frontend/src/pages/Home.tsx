import { useEffect, useMemo, useState } from 'react';
import type { Category } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { filterEventsByDay, filterEventsFromHour } from '../lib/buckets';
import {
  parseSlugParam, selectionFor, selectionToSlugs, slugsToSelection, withSelection,
  type VenueSelection,
} from '../lib/venue-selection';
import { EventBuckets } from '../components/EventBuckets';
import { CategoryBar } from '../components/CategoryBar';
import { DayBar } from '../components/DayBar';
import { TimeBar } from '../components/TimeBar';
import { VenueBar } from '../components/VenueBar';
import { EmptyState, ErrorState, SkeletonList } from '../components/states';
import { FestivalsSection } from '../components/FestivalsSection';

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
  const [day, setDay] = useState<string | null>(null);
  const [fromHour, setFromHour] = useState<number | null>(null);

  const [venueSelection, setVenueSelection] = useState<VenueSelection>({});

  const eventsQuery = trpc.events.listDefault.useQuery(
    category ? { filters: { categories: [category] } } : undefined,
    { refetchInterval: REFETCH_INTERVAL_MS, refetchOnWindowFocus: true },
  );
  const venuesQuery = trpc.venues.list.useQuery();

  // The chips (GOI-76). Keyed on category/day/hour only — never on the
  // selection, so picking a venue re-renders from cache instead of refetching
  // counts that by definition didn't change.
  const filterOptionsQuery = trpc.events.filterOptions.useQuery(
    { category: category ?? undefined, day: day ?? undefined, fromHour: fromHour ?? undefined },
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

  const events = useMemo(() => {
    const byTime = filterEventsFromHour(
      filterEventsByDay(eventsQuery.data ?? [], day),
      fromHour,
    );
    if (selectedVenues.length === 0) return byTime;
    const wanted = new Set(selectedVenues);
    return byTime.filter((e) => wanted.has(e.venueId));
  }, [eventsQuery.data, day, fromHour, selectedVenues]);

  return (
    <section>
      <Hero />

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
          {events.length > 0 ? <EventBuckets events={events} venues={venueMap} /> : null}
        </div>

        {/* Festivals are cinema news — keep them visible on the unfiltered view
            and the cinema tab, but out of the way of other categories. */}
        {category === null || category === 'cinema' ? <FestivalsSection /> : null}
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

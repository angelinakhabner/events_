import { useMemo, useState } from 'react';
import type { Category } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import {
  dayFilterRange, filterEventsByDay, filterEventsFrom, nextEventStart, visibleEvents,
  type DayFilter,
} from '../lib/buckets';
import { dayFilterPhrase } from '../lib/format';
import { EventBuckets } from './EventBuckets';
import { CategoryBar } from './CategoryBar';
import { DayBar } from './DayBar';
import { PanelHeading } from './PanelHeading';
import { EmptyState, ErrorState, NextUpNotice, SkeletonList } from './states';
import { MyFestivalsSection } from './MyFestivalsSection';

const REFETCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * /my → "Events" (GOI-27): what's on at the venues you follow, not the shared
 * public listing. Scoped server-side to your active folder's venues, with the
 * same category/day filters as the public home.
 */
export function MyEventsSection() {
  const [category, setCategory] = useState<Category | null>(null);
  const [day, setDay] = useState<DayFilter>(null);

  const eventsQuery = trpc.my.events.list.useQuery(
    category ? { filters: { categories: [category] } } : undefined,
    { refetchInterval: REFETCH_INTERVAL_MS, refetchOnWindowFocus: true },
  );
  const venuesQuery = trpc.my.venues.list.useQuery();

  const venueMap = useMemo(
    () => new Map((venuesQuery.data ?? []).map((v) => [v.id, v])),
    [venuesQuery.data],
  );

  // Same rule as the public listing (GOI-88): what the day strip selected, and
  // — when that is empty — the nearest events with the date named above them.
  // This list is small enough to arrive whole, so the window is applied here
  // rather than in SQL as the public feed's is.
  const range = useMemo(() => dayFilterRange(day), [day]);
  const nearest = useMemo(() => {
    const rows = eventsQuery.data ?? [];
    return visibleEvents(range ? filterEventsFrom(rows, range.fromDay) : rows);
  }, [eventsQuery.data, range]);
  const selected = useMemo(
    () => (range ? filterEventsByDay(nearest, day) : nearest),
    [nearest, range, day],
  );
  const fallback = range !== null && selected.length === 0 && nearest.length > 0;
  const events = fallback ? nearest : selected;

  const noVenues = venuesQuery.data && venuesQuery.data.length === 0;

  return (
    <section>
      <PanelHeading
        title="Events"
        blurb="What's coming up at the venues in your active folder."
        rule={false}
      />

      <CategoryBar selected={category} onChange={setCategory} compact />
      <DayBar selected={day} onChange={setDay} />

      <div className="mt-2">
        {eventsQuery.isLoading ? <SkeletonList /> : null}
        {eventsQuery.error ? (
          <ErrorState message="Couldn't load your events." onRetry={() => eventsQuery.refetch()} />
        ) : null}
        {!eventsQuery.isLoading && !eventsQuery.error && events.length === 0 ? (
          <EmptyState
            title={
              noVenues
                ? 'No venues in this folder yet.'
                : category || day
                  ? 'Nothing at your venues matches your selection.'
                  : 'Nothing coming up at your venues.'
            }
            hint={noVenues ? 'Add venues under "My venues" and their events show up here.' : undefined}
            action={
              category || day
                ? { label: 'Show all', onClick: () => { setCategory(null); setDay(null); } }
                : undefined
            }
          />
        ) : null}
        {fallback ? (
          <NextUpNotice scope={dayFilterPhrase(day)} nextIso={nextEventStart(nearest)} />
        ) : null}
        {events.length > 0 ? <EventBuckets events={events} venues={venueMap} compact /> : null}
      </div>

      {/* Festivals often replace the normal repertoire rather than appearing in
          it, so they belong here even when the listing above is empty (GOI-33). */}
      <MyFestivalsSection />
    </section>
  );
}

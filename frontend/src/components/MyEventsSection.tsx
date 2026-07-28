import { useMemo, useState } from 'react';
import type { Category } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { filterEventsByDay } from '../lib/buckets';
import { EventBuckets } from './EventBuckets';
import { CategoryBar } from './CategoryBar';
import { DayBar } from './DayBar';
import { EmptyState, ErrorState, SkeletonList } from './states';

const REFETCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * /my → "Events" (GOI-27): what's on at the venues you follow, not the shared
 * public listing. Scoped server-side to your active folder's venues, with the
 * same category/day filters as the public home.
 */
export function MyEventsSection() {
  const [category, setCategory] = useState<Category | null>(null);
  const [day, setDay] = useState<string | null>(null);

  const eventsQuery = trpc.my.events.list.useQuery(
    category ? { filters: { categories: [category] } } : undefined,
    { refetchInterval: REFETCH_INTERVAL_MS, refetchOnWindowFocus: true },
  );
  const venuesQuery = trpc.my.venues.list.useQuery();

  const venueMap = useMemo(
    () => new Map((venuesQuery.data ?? []).map((v) => [v.id, v])),
    [venuesQuery.data],
  );

  const events = useMemo(
    () => filterEventsByDay(eventsQuery.data ?? [], day),
    [eventsQuery.data, day],
  );

  const noVenues = venuesQuery.data && venuesQuery.data.length === 0;

  return (
    <section>
      <div className="mb-6">
        <h2 className="font-serif text-2xl tracking-tight">Events</h2>
        <p className="mt-1 text-sm text-muted max-w-prose">
          What&rsquo;s coming up at the venues in your active folder.
        </p>
      </div>

      <CategoryBar selected={category} onChange={setCategory} />
      <DayBar selected={day} onChange={setDay} />

      <div className="mt-6">
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
        {events.length > 0 ? <EventBuckets events={events} venues={venueMap} /> : null}
      </div>
    </section>
  );
}

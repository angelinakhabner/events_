import { useMemo, useState } from 'react';
import type { Category } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { filterEventsByDay } from '../lib/buckets';
import { EventBuckets } from '../components/EventBuckets';
import { CategoryBar } from '../components/CategoryBar';
import { DayBar } from '../components/DayBar';
import { EmptyState, ErrorState, SkeletonList } from '../components/states';
import { FestivalsSection } from '../components/FestivalsSection';

const REFETCH_INTERVAL_MS = 5 * 60 * 1000;

export function HomePage() {
  const [category, setCategory] = useState<Category | null>(null);
  const [day, setDay] = useState<string | null>(null);

  const eventsQuery = trpc.events.listDefault.useQuery(
    category ? { filters: { categories: [category] } } : undefined,
    { refetchInterval: REFETCH_INTERVAL_MS, refetchOnWindowFocus: true },
  );
  const venuesQuery = trpc.venues.list.useQuery();

  const venueMap = useMemo(
    () => new Map((venuesQuery.data ?? []).map((v) => [v.id, v])),
    [venuesQuery.data],
  );

  const events = useMemo(
    () => filterEventsByDay(eventsQuery.data ?? [], day),
    [eventsQuery.data, day],
  );

  return (
    <section>
      <div className="mb-6">
        <h1 className="font-serif text-4xl tracking-tight">What&rsquo;s on</h1>
        <p className="mt-2 text-muted max-w-prose">
          Live screenings in Warsaw, refreshed every few minutes.
        </p>
      </div>

      <CategoryBar selected={category} onChange={setCategory} />
      <DayBar selected={day} onChange={setDay} />

      <div className="mt-6">
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
              category || day
                ? 'No upcoming events match your selection.'
                : 'No upcoming events.'
            }
            action={
              category || day
                ? {
                    label: 'Show all',
                    onClick: () => {
                      setCategory(null);
                      setDay(null);
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
    </section>
  );
}

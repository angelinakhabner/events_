import { useMemo, useState } from 'react';
import type { Category } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { EventBuckets } from '../components/EventBuckets';
import { CategoryBar } from '../components/CategoryBar';
import { DateFilterBar } from '../components/DateFilterBar';
import { filterEventsByDate, type DateRange } from '../lib/date-filter';
import { EmptyState, ErrorState, SkeletonList } from '../components/states';

const REFETCH_INTERVAL_MS = 5 * 60 * 1000;

export function HomePage() {
  const [category, setCategory] = useState<Category | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>({ kind: 'all' });

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
    () => filterEventsByDate(eventsQuery.data ?? [], dateRange),
    [eventsQuery.data, dateRange],
  );

  const isFiltered = category !== null || dateRange.kind !== 'all';

  return (
    <section>
      <div className="mb-6">
        <h1 className="font-serif text-4xl tracking-tight">What&rsquo;s on</h1>
        <p className="mt-2 text-muted max-w-prose">
          Live screenings in Warsaw, refreshed every few minutes.
        </p>
      </div>

      <CategoryBar selected={category} onChange={setCategory} />
      <DateFilterBar value={dateRange} onChange={setDateRange} />

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
            title="No upcoming events for these filters."
            action={
              isFiltered
                ? {
                    label: 'Clear filters',
                    onClick: () => {
                      setCategory(null);
                      setDateRange({ kind: 'all' });
                    },
                  }
                : undefined
            }
          />
        ) : null}
        {events.length > 0 ? <EventBuckets events={events} venues={venueMap} /> : null}
      </div>
    </section>
  );
}

import { useMemo } from 'react';
import { trpc } from '../lib/trpc';
import { EventBuckets } from '../components/EventBuckets';
import { EmptyState, ErrorState, SkeletonList } from '../components/states';

const REFETCH_INTERVAL_MS = 5 * 60 * 1000;

export function HomePage() {
  const eventsQuery = trpc.events.listDefault.useQuery(undefined, {
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
  const venuesQuery = trpc.venues.list.useQuery();

  const venueMap = useMemo(
    () => new Map((venuesQuery.data ?? []).map((v) => [v.id, v])),
    [venuesQuery.data],
  );

  const events = eventsQuery.data ?? [];

  return (
    <section>
      <div className="mb-10">
        <h1 className="font-serif text-4xl tracking-tight">What&rsquo;s on</h1>
        <p className="mt-2 text-muted max-w-prose">
          Live screenings in Warsaw, refreshed every few minutes.
        </p>
      </div>

      <div className="mt-2">
        {eventsQuery.isLoading ? <SkeletonList /> : null}
        {eventsQuery.error ? (
          <ErrorState
            message="Couldn't load events."
            onRetry={() => eventsQuery.refetch()}
          />
        ) : null}
        {!eventsQuery.isLoading && !eventsQuery.error && events.length === 0 ? (
          <EmptyState title="No upcoming events." />
        ) : null}
        {events.length > 0 ? <EventBuckets events={events} venues={venueMap} /> : null}
      </div>
    </section>
  );
}

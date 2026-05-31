import { useMemo, useState } from 'react';
import type { EventFilters } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { FilterBar } from '../components/FilterBar';
import { EventList } from '../components/EventList';
import { EmptyState, ErrorState, SkeletonList } from '../components/states';

export function HomePage() {
  const [filters, setFilters] = useState<EventFilters>({});

  const eventsQuery = trpc.events.listDefault.useQuery({ filters });
  const venuesQuery = trpc.venues.list.useQuery();

  const venueMap = useMemo(
    () => new Map((venuesQuery.data ?? []).map((v) => [v.id, v])),
    [venuesQuery.data],
  );

  return (
    <section>
      <div className="mb-10">
        <h1 className="font-serif text-4xl tracking-tight">What&rsquo;s on</h1>
        <p className="mt-2 text-muted max-w-prose">
          A curated default set of cultural events. Filter, browse, then add your own venues
          and group them into folders in <a href="/my" className="link-accent">/my</a>.
        </p>
      </div>

      <div className="border-y border-rule">
        <FilterBar filters={filters} onChange={setFilters} />
      </div>

      <div className="mt-10">
        {eventsQuery.isLoading ? <SkeletonList /> : null}
        {eventsQuery.error ? (
          <ErrorState
            message="Couldn't load events."
            onRetry={() => eventsQuery.refetch()}
          />
        ) : null}
        {eventsQuery.data && eventsQuery.data.length === 0 ? (
          <EmptyState
            title="No events match your filters"
            action={{ label: 'Reset filters', onClick: () => setFilters({}) }}
          />
        ) : null}
        {eventsQuery.data && eventsQuery.data.length > 0 ? (
          <EventList events={eventsQuery.data} venues={venueMap} />
        ) : null}
      </div>
    </section>
  );
}

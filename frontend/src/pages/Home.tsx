import { useMemo, useState } from 'react';
import type { Category } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { filterEventsByDay, filterEventsFromHour } from '../lib/buckets';
import { EventBuckets } from '../components/EventBuckets';
import { CategoryBar } from '../components/CategoryBar';
import { DayBar } from '../components/DayBar';
import { TimeBar } from '../components/TimeBar';
import { EmptyState, ErrorState, SkeletonList } from '../components/states';
import { FestivalsSection } from '../components/FestivalsSection';

const REFETCH_INTERVAL_MS = 5 * 60 * 1000;

export function HomePage() {
  const [category, setCategory] = useState<Category | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [fromHour, setFromHour] = useState<number | null>(null);

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
    () => filterEventsFromHour(filterEventsByDay(eventsQuery.data ?? [], day), fromHour),
    [eventsQuery.data, day, fromHour],
  );

  return (
    <section>
      <Hero />

      <div className="page-x">
        <CategoryBar selected={category} onChange={setCategory} />
        <DayBar selected={day} onChange={setDay} />
        <TimeBar selected={fromHour} onChange={setFromHour} />

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
                category || day || fromHour !== null
                  ? 'No upcoming events match your selection.'
                  : 'No upcoming events.'
              }
              action={
                category || day || fromHour !== null
                  ? {
                      label: 'Show all',
                      onClick: () => {
                        setCategory(null);
                        setDay(null);
                        setFromHour(null);
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

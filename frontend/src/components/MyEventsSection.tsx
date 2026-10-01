import { useMemo, useState } from 'react';
import type { Category } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import {
  dayFilterRange, filterEventsByDay, filterEventsFrom, nextEventStart, visibleEvents,
  type DayFilter,
} from '../lib/buckets';
import { dayFilterPhrase } from '../lib/format';
import { myVenueOptions, selectionFor, withSelection, type VenueSelection } from '../lib/venue-selection';
import { EventBuckets } from './EventBuckets';
import { CategoryBar } from './CategoryBar';
import { DayBar } from './DayBar';
import { VenueBar } from './VenueBar';
import { PanelHeading } from './PanelHeading';
import { EmptyState, ErrorState, NextUpNotice, SkeletonList } from './states';

const REFETCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * /my → "Events" (GOI-27): what's on at the venues you follow, not the shared
 * public listing. Scoped server-side to your active folder's venues, with the
 * same category/day/venue filters as the public home (GOI-135).
 */
export function MyEventsSection() {
  const [category, setCategory] = useState<Category | null>(null);
  const [day, setDay] = useState<DayFilter>(null);
  // Remembered per category, as on Home (GOI-76 §5): two cinemas picked, a
  // look at Theatre, and back to Cinema finds the two still picked.
  const [venueSelection, setVenueSelection] = useState<VenueSelection>({});
  const selectedVenues = selectionFor(venueSelection, category);

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
  const upcoming = useMemo(() => visibleEvents(eventsQuery.data ?? []), [eventsQuery.data]);
  // Before the venue pick, because the chips count these: a chip's number is
  // what that venue has in the window, not what is left once it is picked.
  const nearestAll = useMemo(
    () => (range ? filterEventsFrom(upcoming, range.fromDay) : upcoming),
    [upcoming, range],
  );
  const selectedAll = useMemo(
    () => (range ? filterEventsByDay(nearestAll, day) : nearestAll),
    [nearestAll, range, day],
  );

  // The venue row under the day strip (GOI-135), the public listing's own:
  // cinema → Kinoteka, Muranów, and picking one narrows the list to it.
  const venueOptions = useMemo(
    () => (category ? myVenueOptions(venuesQuery.data ?? [], category, upcoming, selectedAll) : []),
    [category, venuesQuery.data, upcoming, selectedAll],
  );
  const nearest = atVenues(nearestAll, selectedVenues);
  const selected = atVenues(selectedAll, selectedVenues);

  const fallback = range !== null && selected.length === 0 && nearest.length > 0;
  const events = fallback ? nearest : selected;

  const noVenues = venuesQuery.data && venuesQuery.data.length === 0;
  const narrowed = category !== null || day !== null || selectedVenues.length > 0;

  return (
    <section>
      <PanelHeading
        title="Wydarzenia"
        blurb="Co nadchodzi w miejscach z Twojego aktywnego folderu."
        rule={false}
      />

      <CategoryBar selected={category} onChange={setCategory} compact />
      <DayBar selected={day} onChange={setDay} />
      <VenueBar
        venues={venueOptions}
        selected={selectedVenues}
        onChange={(ids) => setVenueSelection((prev) => withSelection(prev, category, ids))}
        category={category}
        loading={venuesQuery.isLoading}
        signedIn
      />

      <div className="mt-2">
        {eventsQuery.isLoading ? <SkeletonList /> : null}
        {eventsQuery.error ? (
          <ErrorState message="Nie udało się wczytać Twoich wydarzeń." onRetry={() => eventsQuery.refetch()} />
        ) : null}
        {!eventsQuery.isLoading && !eventsQuery.error && events.length === 0 ? (
          <EmptyState
            title={
              noVenues
                ? 'W tym folderze nie ma jeszcze miejsc.'
                : narrowed
                  ? 'Nic w Twoich miejscach nie pasuje do wybranych filtrów.'
                  : 'W Twoich miejscach nic nie nadchodzi.'
            }
            hint={noVenues ? 'Dodaj miejsca w sekcji „Moje miejsca”, a ich wydarzenia pojawią się tutaj.' : undefined}
            action={
              narrowed
                ? {
                    label: 'Pokaż wszystko',
                    onClick: () => {
                      setCategory(null);
                      setDay(null);
                      setVenueSelection({});
                    },
                  }
                : undefined
            }
          />
        ) : null}
        {fallback ? (
          <NextUpNotice scope={dayFilterPhrase(day)} nextIso={nextEventStart(nearest)} />
        ) : null}
        {events.length > 0 ? (
          <EventBuckets
            events={events}
            venues={venueMap}
            compact
            exhibitionsFirst={category === 'exhibition'}
          />
        ) : null}
      </div>
    </section>
  );
}

/** The rows at the picked venues; none picked means all of them. */
function atVenues<T extends { venueId: string }>(rows: T[], venueIds: string[]): T[] {
  if (venueIds.length === 0) return rows;
  const wanted = new Set(venueIds);
  return rows.filter((e) => wanted.has(e.venueId));
}

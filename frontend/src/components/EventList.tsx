import type { Event, Venue } from '@afisz/shared';
import { EventCard } from './EventCard';
import { formatDayKey, formatDayLabel } from '../lib/format';
import { dedupeAllDay } from '../lib/buckets';

interface Props {
  events: Event[];
  venues: Map<string, Venue>;
}

export function EventList({ events, venues }: Props) {
  const groups = groupByDay(events);
  return (
    <div>
      {groups.map(({ key, label, items }) => (
        <section key={key} className="mb-12">
          <div className="flex items-baseline justify-between gap-4 pb-2">
            <h2 className="font-display text-[28px] md:text-[34px] m-0">{label}</h2>
            <span className="tag shrink-0">{items.length} event{items.length === 1 ? '' : 's'}</span>
          </div>
          <div className="rule-ink" />
          <ul className="list-none m-0 p-0">
            {items.map((e) => (
              <li key={e.id} className="rule-soft">
                <EventCard event={e} venue={venues.get(e.venueId)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function groupByDay(events: Event[]): { key: string; label: string; items: Event[] }[] {
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const map = new Map<string, Event[]>();
  for (const e of sorted) {
    const key = formatDayKey(e.startsAt);
    const list = map.get(key);
    if (list) list.push(e);
    else map.set(key, [e]);
  }
  return [...map.entries()].map(([key, items]) => ({
    key,
    label: formatDayLabel(items[0]!.startsAt),
    // Per day, not across the listing: this view is grouped by day, so an
    // exhibition belongs in each day it is open — just once in each (GOI-53).
    items: dedupeAllDay(items),
  }));
}

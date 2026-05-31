import type { Event, Venue } from '@goin/shared';
import { EventCard } from './EventCard';
import { formatDayKey, formatDayLabel } from '../lib/format';

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
          <div className="flex items-baseline justify-between border-b border-rule pb-3 mb-2">
            <h2 className="font-serif text-2xl">{label}</h2>
            <span className="tag">{items.length} event{items.length === 1 ? '' : 's'}</span>
          </div>
          <ul className="divide-y divide-rule">
            {items.map((e) => (
              <li key={e.id}>
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
    items,
  }));
}

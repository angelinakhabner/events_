import type { Event, Venue } from '@goin/shared';
import { bucketEvents, type Bucket, type BucketKey } from '../lib/buckets';
import { categoryLabel, formatShortDate, formatTime } from '../lib/format';
import { EventActions } from './EventActions';

interface Props {
  events: Event[];
  venues: Map<string, Venue>;
  now?: Date;
}

export function EventBuckets({ events, venues, now }: Props) {
  const buckets = bucketEvents(events, now);
  if (buckets.length === 0) return null;
  return (
    <div>
      {buckets.map((b) => (
        <BucketSection key={b.key} bucket={b} venues={venues} />
      ))}
    </div>
  );
}

function BucketSection({ bucket, venues }: { bucket: Bucket; venues: Map<string, Venue> }) {
  const showDate = bucket.key === 'tomorrow' || bucket.key === 'thisWeek';
  const accent = bucket.key === 'soon';
  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between border-b border-rule pb-3 mb-2">
        <h2 className={`font-serif text-2xl ${accent ? 'text-accent' : ''}`}>{bucket.label}</h2>
        <span className="tag">{bucket.items.length} event{bucket.items.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="divide-y divide-rule">
        {bucket.items.map((e) => (
          <li key={e.id}>
            <EventRow event={e} venue={venues.get(e.venueId)} showDate={showDate} highlight={accent} bucketKey={bucket.key} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EventRow({
  event, venue, showDate, highlight, bucketKey,
}: { event: Event; venue: Venue | undefined; showDate: boolean; highlight: boolean; bucketKey: BucketKey }) {
  const defaultLang = venue?.language ?? null;
  const lang = event.language;
  const showLang = lang && (!defaultLang || lang.toLowerCase() !== defaultLang.toLowerCase());
  return (
    <div className="group block py-6">
      <div className="flex items-baseline gap-6">
        <div className="w-24 shrink-0 text-sm tabular-nums text-muted">
          <div className={highlight ? 'text-accent font-semibold' : ''}>{formatTime(event.startsAt)}</div>
          {showDate ? (
            <div className="text-xs text-muted/80">{formatShortDate(event.startsAt)}</div>
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="no-underline"
            >
              <h3 className="font-serif text-xl leading-snug text-ink group-hover:text-accent transition-colors">
                {event.title}
              </h3>
            </a>
            {bucketKey === 'soon' ? <span className="tag text-accent">Soon</span> : null}
          </div>
          <div className="mt-1 text-sm text-muted flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{venue?.name ?? 'Unknown venue'}</span>
            <span className="tag">{categoryLabel(event.category)}</span>
            {event.durationMinutes ? <span>{event.durationMinutes} min</span> : null}
            {showLang ? <span className="tag uppercase">{lang}</span> : null}
          </div>
          {event.description ? (
            <p className="mt-2 text-sm text-ink/70 line-clamp-2 max-w-prose">{event.description}</p>
          ) : null}
          <EventActions event={event} venue={venue} />
        </div>
      </div>
    </div>
  );
}

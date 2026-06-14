import type { Event, Venue } from '@goin/shared';
import { categoryLabel, formatTime } from '../lib/format';

interface Props {
  event: Event;
  /** Fallback venue when `event.venue` isn't populated (mocks / older callers). */
  venue?: Venue;
}

export function EventCard({ event, venue }: Props) {
  // Prefer the inline venue from the API response — it can't drift from the
  // event the way a separate venues.list could. Only fall back when callers
  // (mostly tests) construct an event without one.
  const v = event.venue ?? venue;
  return (
    <a
      href={event.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="group block py-6 no-underline"
    >
      <div className="flex items-baseline gap-6">
        <div className="w-16 shrink-0 text-sm tabular-nums text-muted">
          {formatTime(event.startsAt)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-xl leading-snug text-ink group-hover:text-accent transition-colors">
            {event.title}
          </h3>
          <div className="mt-1 text-sm text-muted">
            {v?.name ?? 'Unknown venue'}
            {v ? <> · <span className="tag">{categoryLabel(v.category)}</span></> : null}
          </div>
          {event.description ? (
            <p className="mt-2 text-sm text-ink/70 line-clamp-2 max-w-prose">
              {event.description}
            </p>
          ) : null}
        </div>
      </div>
    </a>
  );
}

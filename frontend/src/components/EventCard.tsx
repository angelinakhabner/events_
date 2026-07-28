import type { Event, Venue } from '@goin/shared';
import { categoryLabel, formatTime } from '../lib/format';
import { EventActions } from './EventActions';
import { ExpandableText } from './ExpandableText';

interface Props {
  event: Event;
  /** Fallback venue when `event.venue` isn't populated (mocks / older callers). */
  venue?: Venue;
}

export function EventCard({ event, venue }: Props) {
  const v = event.venue ?? venue;
  return (
    <article className="py-6">
      <div className="flex items-baseline gap-6">
        <div className="w-16 shrink-0 text-sm tabular-nums text-muted">
          {formatTime(event.startsAt)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="headline text-xl">
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-ink hover:text-accent transition-colors no-underline"
            >
              {event.title}
            </a>
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            {v ? <span className="tag-filled">{categoryLabel(v.category)}</span> : null}
            <span className="tag">{v?.name ?? 'Unknown venue'}</span>
          </div>
          {event.description ? (
            <ExpandableText text={event.description} className="mt-2" />
          ) : null}
          <EventActions event={event} />
        </div>
      </div>
    </article>
  );
}

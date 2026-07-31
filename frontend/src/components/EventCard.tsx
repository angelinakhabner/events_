import type { Event, Venue } from '@afisz/shared';
import { categoryLabel, formatEventTime } from '../lib/format';
import { CategorySwatch } from './CategorySwatch';
import { EventActions } from './EventActions';
import { ExpandableText } from './ExpandableText';

interface Props {
  event: Event;
  /** Fallback venue when `event.venue` isn't populated (mocks / older callers). */
  venue?: Venue;
}

/** A single event outside the bucketed listing (folder views). Same anatomy as
 *  an EventBuckets row, minus the day grouping. */
export function EventCard({ event, venue }: Props) {
  const v = event.venue ?? venue;
  return (
    <article className="flex flex-wrap gap-x-5 gap-y-2 md:gap-x-7 py-5 md:py-[26px]">
      {/* One clock, two placements. `md:contents` dissolves this wrapper on
          desktop so the swatch and time become columns of the row itself;
          below `md` they stay grouped as a single meta line above the title.
          Rendering them once rather than per-breakpoint keeps one copy of the
          time in the DOM. */}
      <div className="flex w-full items-center gap-2.5 md:contents">
        <span className="shrink-0 pt-0.5 md:order-2 md:w-[18px] md:pt-1">
          <CategorySwatch category={event.category} size={14} />
        </span>
        <span className="text-xs md:text-sm font-bold text-muted tabular-nums whitespace-nowrap md:order-1 md:w-[70px] md:shrink-0">
          {formatEventTime(event)}
        </span>
      </div>

      <div className="flex-1 min-w-0 md:order-3">
        <h3 className="m-0 text-[19px] md:text-[21px] font-bold leading-[1.2]">
          <a href={event.sourceUrl} target="_blank" rel="noreferrer" className="text-ink hover:text-accent">
            {event.title}
          </a>
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] md:text-[13px] font-bold uppercase tracking-[1px]">
          <span className="text-ink">{v?.name ?? 'Unknown venue'}</span>
          {v ? <span className="text-muted">{categoryLabel(v.category)}</span> : null}
        </div>
        {event.description ? (
          <ExpandableText text={event.description} className="mt-2.5" />
        ) : null}
        <EventActions event={event} />
      </div>
    </article>
  );
}

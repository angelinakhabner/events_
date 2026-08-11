import type { Event, Venue } from '@afisz/shared';
import { bucketEvents, splitExhibitions, type Bucket, type BucketKey } from '../lib/buckets';
import { categoryLabel, formatEventTime, formatExhibitionRange, formatShortDate } from '../lib/format';
import { CategorySwatch } from './CategorySwatch';
import { EventActions } from './EventActions';
import { ExpandableText } from './ExpandableText';

interface Props {
  events: Event[];
  venues: Map<string, Venue>;
  now?: Date;
  /** Denser variant used inside /my, where the column is narrower. */
  compact?: boolean;
}

export function EventBuckets({ events, venues, now, compact = false }: Props) {
  // Exhibitions are pulled out here rather than by each caller, so every view
  // that renders a listing gets the same treatment (GOI-67).
  const { timed, exhibitions } = splitExhibitions(events);
  const buckets = bucketEvents(timed, now);
  if (buckets.length === 0 && exhibitions.length === 0) return null;
  return (
    <div>
      {buckets.map((b) => (
        <BucketSection key={b.key} bucket={b} venues={venues} compact={compact} />
      ))}
      {/* Below the timed buckets: a run is context for the week, not an
          answer to "what's on tonight". A category with only exhibitions
          renders this section alone — no empty time-bucket headings, because
          `bucketEvents` returns nothing to head. */}
      {exhibitions.length > 0 ? (
        <ExhibitionsSection items={exhibitions} venues={venues} now={now} compact={compact} />
      ) : null}
    </div>
  );
}

/** The "Ongoing exhibitions" section: same poster anatomy as a time bucket,
 *  but its rows carry date ranges where the others carry a clock. */
function ExhibitionsSection({
  items, venues, now, compact,
}: { items: Event[]; venues: Map<string, Venue>; now?: Date; compact: boolean }) {
  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between gap-4 pt-6 pb-2 md:pt-9">
        <h2
          className={`font-display m-0 tracking-[0.5px] text-ink ${
            compact ? 'text-[28px] md:text-[34px]' : 'text-[28px] md:text-[44px]'
          }`}
        >
          Ongoing exhibitions
        </h2>
        <span className="tag shrink-0 text-[11px] md:text-[13px]">
          {items.length} event{items.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="rule-ink" />
      <ul className="list-none m-0 p-0">
        {items.map((e) => (
          <li key={e.id} className="rule-soft">
            <ExhibitionRow
              event={e}
              venue={venues.get(e.venueId)}
              now={now}
              compact={compact}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * An exhibition row. Structurally identical to `EventRow` — same gutter, same
 * title block — with the clock replaced by the run's dates and "nearest
 * dates" dropped: there is nothing to be nearest to when the thing is on
 * every day.
 */
function ExhibitionRow({
  event, venue, now, compact,
}: { event: Event; venue: Venue | undefined; now?: Date; compact: boolean }) {
  const range = formatExhibitionRange(event, now);
  return (
    <div className={`flex flex-wrap gap-x-5 gap-y-2 md:gap-x-7 ${compact ? 'py-5' : 'py-5 md:py-[26px]'}`}>
      <div className="flex w-full items-center gap-2.5 md:contents">
        <span className="shrink-0 pt-0.5 md:order-2 md:w-[18px] md:pt-1">
          <CategorySwatch category={event.category} size={compact ? 14 : 16} />
        </span>
        <span
          className={`text-xs md:text-[13px] lg:text-sm font-bold text-muted md:order-1 md:shrink-0 ${
            compact ? 'md:w-[70px]' : 'md:w-[90px]'
          }`}
        >
          {range}
        </span>
      </div>

      <div className="flex-1 min-w-0 md:order-3">
        <a href={event.sourceUrl} target="_blank" rel="noreferrer">
          <h3
            className={`m-0 font-bold leading-[1.15] text-ink hover:text-accent ${
              compact ? 'text-[19px] md:text-[21px]' : 'text-[19px] md:text-[26px]'
            }`}
          >
            {event.title}
          </h3>
        </a>

        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] md:text-[13px] font-bold uppercase tracking-[1px]">
          <span className="text-ink">{venue?.name ?? event.venue?.name ?? 'Unknown venue'}</span>
          <span className="text-muted">{categoryLabel(event.category)}</span>
        </div>

        {event.description ? (
          <ExpandableText text={event.description} className="mt-2.5" />
        ) : null}
        <EventActions event={event} />
      </div>
    </div>
  );
}

/**
 * One bucket ("Tonight", "Tomorrow", …) as a poster section: an Anton title
 * flush left, its count flush right, and a heavy rule opening the listing.
 */
function BucketSection({
  bucket, venues, compact,
}: { bucket: Bucket; venues: Map<string, Venue>; compact: boolean }) {
  // "Later" can be months out, so the row must carry its date like the
  // multi-day buckets do — the heading names the day, but the rows shouldn't
  // rely on the reader having read it.
  const showDate =
    bucket.key === 'tomorrow' || bucket.key === 'thisWeek' || bucket.key === 'later';
  const accent = bucket.key === 'soon';
  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between gap-4 pt-6 pb-2 md:pt-9">
        <h2
          className={`font-display m-0 tracking-[0.5px] ${
            compact ? 'text-[28px] md:text-[34px]' : 'text-[28px] md:text-[44px]'
          } ${accent ? 'text-accent' : 'text-ink'}`}
        >
          {bucket.label}
        </h2>
        <span className="tag shrink-0 text-[11px] md:text-[13px]">
          {bucket.items.length} event{bucket.items.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="rule-ink" />
      <ul className="list-none m-0 p-0">
        {bucket.items.map((e) => (
          <li key={e.id} className="rule-soft">
            <EventRow
              event={e}
              venue={venues.get(e.venueId)}
              showDate={showDate}
              highlight={accent}
              bucketKey={bucket.key}
              compact={compact}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A listings row: a fixed clock column, the category swatch, then the title
 * block. On mobile the clock and swatch collapse into a single meta line above
 * the title, since a 90px gutter would leave nothing for the title itself.
 */
function EventRow({
  event, venue, showDate, highlight, bucketKey, compact,
}: {
  event: Event;
  venue: Venue | undefined;
  showDate: boolean;
  highlight: boolean;
  bucketKey: BucketKey;
  compact: boolean;
}) {
  const defaultLang = venue?.language ?? null;
  const lang = event.language;
  const showLang = lang && (!defaultLang || lang.toLowerCase() !== defaultLang.toLowerCase());
  const time = formatEventTime(event);
  const date = formatShortDate(event.startsAt);

  return (
    <div className={`flex flex-wrap gap-x-5 gap-y-2 md:gap-x-7 ${compact ? 'py-5' : 'py-5 md:py-[26px]'}`}>
      {/* One clock, two placements. `md:contents` dissolves this wrapper on
          desktop so the swatch and time become columns of the row itself;
          below `md` they stay grouped as a single meta line above the title.
          Rendering them once rather than per-breakpoint keeps one copy of the
          time and date in the DOM. */}
      <div className="flex w-full items-center gap-2.5 md:contents">
        <span className="shrink-0 pt-0.5 md:order-2 md:w-[18px] md:pt-1">
          <CategorySwatch category={event.category} size={compact ? 14 : 16} />
        </span>
        <span
          className={`text-xs md:text-[13px] lg:text-sm font-bold md:order-1 md:shrink-0 ${
            compact ? 'md:w-[70px]' : 'md:w-[90px]'
          } ${highlight ? 'text-accent' : 'text-muted'}`}
        >
          <span className="whitespace-nowrap">{time}</span>
          {showDate ? (
            <>
              <span aria-hidden className="md:hidden"> · </span>
              {/* Inline after the time on mobile, its own line in the gutter
                  from `md` — same text node either way. */}
              <span className="md:block text-muted whitespace-nowrap">{date}</span>
            </>
          ) : null}
        </span>
      </div>

      <div className="flex-1 min-w-0 md:order-3">
        <div className="flex items-baseline gap-3">
          <a href={event.sourceUrl} target="_blank" rel="noreferrer">
            <h3
              className={`m-0 font-bold leading-[1.15] text-ink hover:text-accent ${
                compact ? 'text-[19px] md:text-[21px]' : 'text-[19px] md:text-[26px]'
              }`}
            >
              {event.title}
            </h3>
          </a>
          {bucketKey === 'soon' ? <span className="tag text-accent">Soon</span> : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] md:text-[13px] font-bold uppercase tracking-[1px]">
          <span className="text-ink">{venue?.name ?? 'Unknown venue'}</span>
          <span className="text-muted">{categoryLabel(event.category)}</span>
          {event.durationMinutes ? (
            <span className="text-muted">{event.durationMinutes} min</span>
          ) : null}
          {showLang ? <span className="text-muted">{lang}</span> : null}
        </div>

        {event.description ? (
          <ExpandableText text={event.description} className="mt-2.5" />
        ) : null}
        <EventActions event={event} />
      </div>
    </div>
  );
}

import { bannerFestivals, isFestivalCategory, type Category, type FestivalCategory } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { CategorySwatch } from './CategorySwatch';

/**
 * "Coming soon" — the festivals belonging to the listing you are looking at
 * (GOI-6, refiled by GOI-68).
 *
 * Festivals used to be one cinema-only block pinned to the bottom of the page,
 * shown on the unfiltered view and the cinema tab and nowhere else. That put
 * film festivals under Theatre whenever the reader had no category selected,
 * and gave theatre and music no way to have festivals at all.
 *
 * Now each listing carries its own, at the foot of its own events: the cinema
 * tab gets film festivals, theatre gets theatre festivals, and the unfiltered
 * view gets all of them. A category that has none renders nothing rather than
 * an empty heading.
 *
 * Drawn as event rows — swatch, dates in the gutter, title, meta line — because
 * that is what they are to a reader scanning the page: another thing that is on.
 */
export function FestivalsSection({ category }: { category: Category | null }) {
  // Exhibition and "other" have no festivals to ask for, so they ask for
  // nothing rather than for everything.
  const scope: FestivalCategory | null =
    category === null ? null : isFestivalCategory(category) ? category : null;
  const enabled = category === null || scope !== null;

  const festivals = trpc.festivals.list.useQuery(scope ? { category: scope } : undefined, { enabled });

  // GOI-99: whatever the banner at the top of the page is already announcing
  // is dropped here. Saying it twice on one screen is not twice as clear — the
  // second telling reads as a different festival until you look closely, and
  // this block's job is the ones the banner is deliberately too early for.
  const inBanner = bannerFestivals(festivals.data ?? []).map((f) => f.id);
  const upcoming = (festivals.data ?? []).filter((f) => !inBanner.includes(f.id));

  if (!enabled || upcoming.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="font-display text-[28px] md:text-[36px] m-0 mb-3">Coming soon</h2>
      <div className="rule-ink" />
      <ul className="list-none m-0 p-0">
        {upcoming.map((f) => (
          <li key={f.id} className="rule-soft">
            {/* Same anatomy as an event row: the meta group collapses to one
                line below `md` and dissolves into columns above it. */}
            <article className="flex flex-wrap gap-x-5 gap-y-2 md:gap-x-7 py-5 md:py-[26px]">
              <div className="flex w-full items-center gap-2.5 md:contents">
                <span className="shrink-0 pt-0.5 md:order-2 md:w-[18px] md:pt-1">
                  <CategorySwatch category={f.category} size={14} />
                </span>
                {/* A festival's "when" is a range, so it needs a wider gutter
                    than a showtime — but it sits in the same column. */}
                <span className="text-xs md:text-sm font-bold text-muted tabular-nums md:order-1 md:w-[92px] md:shrink-0">
                  {formatRange(f.startDate, f.endDate)}
                </span>
              </div>

              <div className="flex-1 min-w-0 md:order-3">
                <h3 className="m-0 text-[19px] md:text-[21px] font-bold leading-[1.2]">
                  <a href={f.url} target="_blank" rel="noreferrer" className="text-ink hover:text-accent">
                    {f.name}
                  </a>
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] md:text-[13px] font-bold uppercase tracking-[1px]">
                  <span className={f.status === 'ongoing' ? 'text-accent' : 'text-muted'}>
                    {f.status === 'ongoing' ? 'Now on' : 'Upcoming'}
                  </span>
                  <span className="text-ink">{f.venues.join(' · ')}</span>
                </div>
                <p className="mt-2 text-sm text-body max-w-[520px]">{f.description}</p>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** "9–18 Oct" / "19 Jun – 30 Aug" from inclusive ISO dates. */
export function formatRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  const startStr = dayFmt.format(start);
  const endStr = dayFmt.format(end);
  const sameMonth = startDate.slice(0, 7) === endDate.slice(0, 7);
  if (startDate === endDate) return startStr;
  if (sameMonth) return `${start.getUTCDate()}–${endStr}`;
  return `${startStr} – ${endStr}`;
}

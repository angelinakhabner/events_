import { bannerFestivals } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { formatRange } from './FestivalsSection';
import { CategorySwatch } from './CategorySwatch';

/**
 * /my → festivals and special events running at the venues you follow (GOI-33).
 *
 * The public Home page lists every festival Goin knows about; this one is
 * narrowed to the reader's own venues and says which of them are hosting, so
 * "there's a festival on" turns into "there's a festival on at your cinema".
 *
 * Hidden entirely when none of your venues is hosting anything — an empty
 * "Festivals" heading tells nobody anything.
 */
export function MyFestivalsSection() {
  const festivals = trpc.festivals.mine.useQuery();

  // Same split as the public listing (GOI-99): the near ones are already the
  // banner at the top of /my, so this block carries the rest.
  const banner = bannerFestivals(festivals.data ?? []).map((f) => f.id);
  const upcoming = (festivals.data ?? []).filter((f) => !banner.includes(f.id));

  if (upcoming.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="font-display text-[28px] md:text-[36px] m-0 mb-1.5">Coming soon at your venues</h2>
      <p className="mb-5 max-w-[520px] text-sm md:text-base text-body">
        Special programmes running at venues you follow — these usually replace the
        normal repertoire, so they may not show up as ordinary listings.
      </p>
      <div className="rule-ink" />
      <ul className="list-none m-0 p-0">
        {upcoming.map((f) => (
          <li key={f.id} className="rule-soft">
            {/* Same anatomy as an event row (GOI-68) — swatch and dates in the
                gutter, title and meta beside them. */}
            <article className="flex flex-wrap gap-x-5 gap-y-2 md:gap-x-7 py-5 md:py-[26px]">
              <div className="flex w-full items-center gap-2.5 md:contents">
                <span className="shrink-0 pt-0.5 md:order-2 md:w-[18px] md:pt-1">
                  <CategorySwatch category={f.category} size={14} />
                </span>
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
                  {/* The reader's *own* venues, named as they name them — the
                      point of the section is recognising your list, not the
                      festival's. */}
                  <span className="text-ink">{f.yourVenues.join(' · ')}</span>
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

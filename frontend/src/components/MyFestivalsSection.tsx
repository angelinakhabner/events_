import { trpc } from '../lib/trpc';
import { formatRange } from './FestivalsSection';

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

  if (!festivals.data || festivals.data.length === 0) return null;

  return (
    <section className="mt-12 border-t border-rule pt-8">
      <h2 className="mb-1 font-serif text-2xl tracking-tight">Festivals at your venues</h2>
      <p className="mb-4 text-sm text-muted max-w-prose">
        Special programmes running at venues you follow — these usually replace the
        normal repertoire, so they may not show up as ordinary listings.
      </p>
      <ul className="divide-y divide-rule border-y border-rule list-none m-0 p-0">
        {festivals.data.map((f) => (
          <li key={f.id} className="py-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-ink hover:text-accent no-underline"
              >
                {f.name}
              </a>
              <span
                className={`text-xs uppercase tracking-wide ${
                  f.status === 'ongoing' ? 'text-accent' : 'text-muted'
                }`}
              >
                {f.status === 'ongoing' ? 'Now on' : 'Upcoming'}
              </span>
              <span className="text-sm text-muted tabular-nums">
                {formatRange(f.startDate, f.endDate)}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted max-w-prose">{f.description}</p>
            {/* The reader's *own* venues, named as they name them — the point of
                the section is recognising your list, not the festival's. */}
            <p className="mt-1 text-xs uppercase tracking-wide text-accent">
              At your {f.yourVenues.length === 1 ? 'venue' : 'venues'}: {f.yourVenues.join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { trpc } from '../lib/trpc';

/**
 * Home — "Festivals" (GOI-6): ongoing and upcoming film festivals at the
 * cinemas Goin covers. Curated server-side (backend/src/data/festivals.ts);
 * hidden entirely when nothing is ongoing or ahead.
 */
export function FestivalsSection() {
  const festivals = trpc.festivals.list.useQuery();

  if (!festivals.data || festivals.data.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="mb-4 font-serif text-2xl tracking-tight">Festivals</h2>
      <ul className="divide-y divide-rule list-none m-0 p-0">
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
            <p className="mt-1 text-sm text-muted">{f.cinemas.join(' · ')}</p>
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

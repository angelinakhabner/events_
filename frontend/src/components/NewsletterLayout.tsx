import type { NewsletterGrouping } from '@afisz/shared';

interface LayoutVenue {
  id: string;
  name: string;
}

/**
 * The covered venues in the reader's order (GOI-140): the ones they placed
 * first, as placed, then the rest in the order the form lists them.
 */
export function orderedVenues<T extends LayoutVenue>(venues: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return venues
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (rank.get(a.v.id) ?? order.length + a.i) - (rank.get(b.v.id) ?? order.length + b.i))
    .map(({ v }) => v);
}

/**
 * The order after moving one venue a step (GOI-140). The shown venues are
 * written out in full, so the order the reader sees is the one saved; ids it
 * held for venues not shown now (unticked, say) are kept after them, so
 * ticking one back brings back its place.
 */
export function moveVenue(shown: LayoutVenue[], order: string[], id: string, step: -1 | 1): string[] {
  const ids = orderedVenues(shown, order).map((v) => v.id);
  const at = ids.indexOf(id);
  const to = at + step;
  if (at < 0 || to < 0 || to >= ids.length) return order;
  [ids[at], ids[to]] = [ids[to]!, ids[at]!];
  return [...ids, ...order.filter((o) => !ids.includes(o))];
}

const GROUPINGS: { value: NewsletterGrouping; label: string; hint: string }[] = [
  {
    value: 'event',
    label: 'Po wydarzeniu',
    hint: 'Każdy tytuł raz, a pod nim miejsca, w których jest grany — w Twojej kolejności.',
  },
  {
    value: 'venue',
    label: 'Po miejscu',
    hint: 'W każdej kategorii osobny blok dla każdego miejsca, z tym, co tam jest — w Twojej kolejności.',
  },
];

/**
 * How an issue arranges its listings (GOI-141) and in what order its venues
 * come (GOI-140). Two controls, one question: "how do I want to read it?".
 */
export function NewsletterLayout({
  groupBy,
  onGroupBy,
  venues,
  order,
  onOrder,
}: {
  groupBy: NewsletterGrouping;
  onGroupBy: (g: NewsletterGrouping) => void;
  /** The venues the newsletter covers, in the form's own order. */
  venues: LayoutVenue[];
  order: string[];
  onOrder: (order: string[]) => void;
}) {
  const current = GROUPINGS.find((g) => g.value === groupBy);
  const shown = orderedVenues(venues, order);

  return (
    <div className="mt-5">
      <p className="label-caps mb-2">Układ wydania</p>
      {/* Same equal-width segmented control as "Dokąd trafia" (GOI-115). */}
      <div role="radiogroup" aria-label="Układ wydania" className="grid grid-cols-2 border-2 border-ink max-w-[420px]">
        {GROUPINGS.map((g, i) => {
          const active = groupBy === g.value;
          return (
            <button
              key={g.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onGroupBy(g.value)}
              className={`w-full cursor-pointer px-4 py-[9px] text-center text-xs font-extrabold uppercase tracking-[0.5px] ${
                i === 0 ? 'border-r-2 border-ink' : ''
              } ${active ? 'bg-ink text-white' : 'bg-transparent text-ink hover:text-accent'}`}
            >
              {g.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-faint max-w-[520px]">{current?.hint}</p>

      {shown.length > 1 ? (
        <div className="mt-5">
          <p className="label-caps mb-2">Kolejność miejsc</p>
          <ol aria-label="Kolejność miejsc" className="max-w-[420px] border-t-2 border-ink">
            {shown.map((v, i) => (
              <li key={v.id} className="flex items-center gap-3 border-b border-rule py-1.5">
                <span className="w-5 text-right text-xs font-extrabold tabular-nums text-faint">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate text-[13px] font-semibold">{v.name}</span>
                <button
                  type="button"
                  className="act act-sm"
                  aria-label={`Przesuń ${v.name} wyżej`}
                  disabled={i === 0}
                  onClick={() => onOrder(moveVenue(venues, order, v.id, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="act act-sm"
                  aria-label={`Przesuń ${v.name} niżej`}
                  disabled={i === shown.length - 1}
                  onClick={() => onOrder(moveVenue(venues, order, v.id, 1))}
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-faint max-w-[520px]">
            W tej kolejności idą bloki miejsc, a przy tytule — miejsca, w których jest grany.
          </p>
        </div>
      ) : null}
    </div>
  );
}

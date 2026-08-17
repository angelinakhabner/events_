import { useMemo } from 'react';
import type { ContentCategory, Event } from '@afisz/shared';

/**
 * What kind of thing, within the selected venue category (GOI-80 UI).
 *
 * The hierarchy lives here rather than in storage: the parent is the venue
 * category chosen in the row above, and the children are the content types
 * *actually present* in the current result set. Derived, not hardcoded — a
 * static row of nine chips where seven return nothing recreates the empty
 * state problem from the other direction, which is exactly what the ticket
 * says not to build.
 *
 * `family` is a separate toggle, not a chip in this row. "Warsztaty rodzinne"
 * is a workshop AND family; putting family among the categories would make
 * choosing it silently drop the workshop signal. Selection within the row is
 * OR; the family toggle ANDs with it.
 */

const LABELS: Record<ContentCategory, string> = {
  exhibition: 'Exhibitions',
  guided_tour: 'Guided tours',
  workshop: 'Workshops',
  screening: 'Screenings',
  lecture: 'Talks',
  concert: 'Concerts',
  performance: 'Performances',
  festival: 'Festivals',
  other: 'Other',
};

export interface ContentCategoryBarProps {
  /** The events the page is currently showing, before this row's own filter. */
  events: Event[];
  selected: ContentCategory[];
  onChange: (next: ContentCategory[]) => void;
  familyOnly: boolean;
  onFamilyChange: (next: boolean) => void;
}

export function ContentCategoryBar({
  events,
  selected,
  onChange,
  familyOnly,
  onFamilyChange,
}: ContentCategoryBarProps) {
  const options = useMemo(() => countByContentCategory(events), [events]);
  const familyCount = useMemo(() => events.filter((e) => e.audience === 'family').length, [events]);

  // Nothing to narrow with: one kind of thing, or none classified yet. A row
  // offering a single chip that selects everything is noise.
  if (options.length < 2 && familyCount === 0) return null;

  const toggle = (c: ContentCategory) => {
    onChange(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);
  };

  return (
    <div
      role="group"
      aria-label="Filter by type"
      className="scroll-x flex flex-nowrap md:flex-wrap items-center gap-x-4 gap-y-2 pb-3"
    >
      {options.map(({ category, count }) => {
        const on = selected.includes(category);
        return (
          <button
            key={category}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(category)}
            aria-label={`${LABELS[category]}, ${count} event${count === 1 ? '' : 's'}`}
            className={`shrink-0 border-2 border-ink px-3 py-1.5 text-[11px] md:text-xs font-extrabold uppercase tracking-[0.5px] cursor-pointer ${
              on ? 'bg-ink text-white' : 'bg-transparent text-ink hover:text-accent hover:border-accent'
            }`}
          >
            {LABELS[category]} <span className="opacity-70">{count}</span>
          </button>
        );
      })}

      {/* Deliberately set apart from the chips: it is a different axis, and
          ANDs with whatever is selected above. */}
      {familyCount > 0 ? (
        <button
          type="button"
          aria-pressed={familyOnly}
          onClick={() => onFamilyChange(!familyOnly)}
          aria-label={`For families, ${familyCount} event${familyCount === 1 ? '' : 's'}`}
          className={`shrink-0 ml-auto md:ml-2 border-2 px-3 py-1.5 text-[11px] md:text-xs font-extrabold uppercase tracking-[0.5px] cursor-pointer ${
            familyOnly
              ? 'border-accent bg-accent text-white'
              : 'border-accent bg-transparent text-accent hover:bg-accent hover:text-white'
          }`}
        >
          For families <span className="opacity-70">{familyCount}</span>
        </button>
      ) : null}
    </div>
  );
}

export interface ContentCategoryOption {
  category: ContentCategory;
  count: number;
}

/**
 * The distinct content types present, with counts, busiest first.
 *
 * Unclassified rows (everything scraped before GOI-80, until its next sweep)
 * are skipped rather than bucketed into "other" — "other" is a real answer the
 * classifier gives, and folding "we haven't looked yet" into it would make the
 * chip lie about what it contains.
 */
export function countByContentCategory(events: Event[]): ContentCategoryOption[] {
  const counts = new Map<ContentCategory, number>();
  for (const e of events) {
    if (!e.contentCategory) continue;
    counts.set(e.contentCategory, (counts.get(e.contentCategory) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    // Zero-count chips are never rendered because a zero can't get here at all.
    .sort((a, b) => b.count - a.count || LABELS[a.category].localeCompare(LABELS[b.category]));
}

/**
 * Apply this row's selection: OR within the categories, AND with family.
 *
 * An empty selection means "all types", not "no types" — the row is a
 * narrowing device, and starting from nothing selected has to show everything.
 */
export function filterByContent(
  events: Event[],
  selected: ContentCategory[],
  familyOnly: boolean,
): Event[] {
  let out = events;
  if (selected.length > 0) {
    const wanted = new Set(selected);
    out = out.filter((e) => e.contentCategory && wanted.has(e.contentCategory));
  }
  if (familyOnly) out = out.filter((e) => e.audience === 'family');
  return out;
}

export { LABELS as CONTENT_CATEGORY_LABELS };

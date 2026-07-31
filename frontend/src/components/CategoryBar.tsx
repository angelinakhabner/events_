import type { Category } from '@afisz/shared';
import { CategorySwatch } from './CategorySwatch';

interface Props {
  selected: Category | null;
  onChange: (next: Category | null) => void;
  /** Denser variant used inside /my, where the column is narrower. */
  compact?: boolean;
}

interface Option {
  label: string;
  value: Category | null;
}

// "Museum" rather than "Exhibition" reads better to a casual visitor; the
// underlying enum value stays the same so existing data and filters work.
const OPTIONS: Option[] = [
  { label: 'All', value: null },
  { label: 'Cinema', value: 'cinema' },
  { label: 'Theatre', value: 'theatre' },
  { label: 'Comedy', value: 'comedy' },
  { label: 'Music', value: 'music' },
  { label: 'Museums', value: 'exhibition' },
];

/**
 * The category chips: butted together with no gaps, divided by ink rules and
 * closed off by a heavier one — a strip of type rather than a row of buttons.
 * The selected chip inverts to white-on-ink.
 *
 * Labels stay mixed-case in the markup and are uppercased in CSS, so the
 * accessible name is still "Museums" rather than "MUSEUMS".
 */
export function CategoryBar({ selected, onChange, compact = false }: Props) {
  return (
    <nav
      aria-label="Filter by category"
      className="flex scroll-x md:flex-wrap border-b-3 border-ink"
    >
      {OPTIONS.map((opt) => {
        const active = (opt.value ?? null) === (selected ?? null);
        return (
          <button
            key={opt.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-r-2 border-ink cursor-pointer ${
              compact ? 'px-[18px] py-3.5' : 'px-4 py-3.5 md:px-6 md:py-[18px]'
            } ${active ? 'bg-ink' : 'bg-transparent'}`}
          >
            {opt.value ? (
              <CategorySwatch category={opt.value} size={compact ? 12 : 14} />
            ) : null}
            <span
              className={`text-xs md:text-sm font-bold uppercase tracking-[1px] ${
                active ? 'text-white' : 'text-ink'
              }`}
            >
              {opt.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

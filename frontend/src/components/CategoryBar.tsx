import type { Category } from '@afisz/shared';
import { categoryLabel } from '../lib/format';
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

// Labels come from `categoryLabel` so the bar and everything else name a
// category the same way — this row used to be the app's second, competing set
// of names ("Museums" here, "Exhibition" everywhere else). GOI-30.
const OPTIONS: Option[] = [
  { label: 'All', value: null },
  ...(['cinema', 'theatre', 'comedy', 'music', 'exhibition'] as const).map((value) => ({
    label: categoryLabel(value),
    value,
  })),
];

/**
 * The category chips: butted together with no gaps, divided by ink rules and
 * closed off by a heavier one — a strip of type rather than a row of buttons.
 * The selected chip fills with accent red.
 *
 * Accent, not ink, because red is what "selected" means everywhere else in the
 * app — `.act-on`, and the day and time bars above (GOI-50). Filling the chip
 * with ink made the top menu say it two different ways.
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
            } ${active ? 'bg-accent' : 'bg-transparent hover:bg-panel'}`}
          >
            {opt.value ? (
              // The palette is two colours, so an accent trapezoid on an accent
              // chip is invisible — as an ink diamond on ink was before it.
              <CategorySwatch category={opt.value} size={compact ? 12 : 14} inverted={active} />
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

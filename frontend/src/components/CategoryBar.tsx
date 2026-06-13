import type { Category } from '@goin/shared';

interface Props {
  selected: Category | null;
  onChange: (next: Category | null) => void;
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

export function CategoryBar({ selected, onChange }: Props) {
  return (
    <nav
      aria-label="Filter by category"
      className="flex flex-wrap gap-x-6 gap-y-3 py-4 border-y border-rule"
    >
      {OPTIONS.map((opt) => {
        const active = (opt.value ?? null) === (selected ?? null);
        return (
          <button
            key={opt.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`tag transition-colors ${
              active ? 'text-accent' : 'text-muted hover:text-ink'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </nav>
  );
}

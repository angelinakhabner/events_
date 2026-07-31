import type { Category, EventFilters } from '@afisz/shared';

const CATEGORIES: Category[] = ['cinema', 'theatre', 'exhibition', 'comedy'];

interface Props {
  filters: EventFilters;
  onChange: (next: EventFilters) => void;
}

export function FilterBar({ filters, onChange }: Props) {
  const toggleCategory = (c: Category) => {
    const current = filters.categories ?? [];
    const next = current.includes(c) ? current.filter((x) => x !== c) : [...current, c];
    onChange({ ...filters, categories: next.length ? next : undefined });
  };

  const setHour = (key: 'startHour' | 'endHour', value: string) => {
    const n = value === '' ? undefined : Number(value);
    onChange({ ...filters, [key]: n });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Categories">
        {CATEGORIES.map((c) => {
          const active = filters.categories?.includes(c) ?? false;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={active}
              onClick={() => toggleCategory(c)}
              className={`border-2 border-ink px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.5px] cursor-pointer ${
                active ? 'bg-ink text-white' : 'bg-transparent text-ink hover:text-accent hover:border-accent'
              }`}
            >
              {c}
            </button>
          );
        })}
      </div>

      <label className="tag flex items-center gap-2">
        From
        <select
          aria-label="Start hour"
          value={filters.startHour ?? ''}
          onChange={(e) => setHour('startHour', e.target.value)}
          className="field-sm text-[11px] font-bold uppercase cursor-pointer"
        >
          <option value="">any</option>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{`${h.toString().padStart(2, '0')}:00`}</option>
          ))}
        </select>
      </label>

      <label className="tag flex items-center gap-2">
        Until
        <select
          aria-label="End hour"
          value={filters.endHour ?? ''}
          onChange={(e) => setHour('endHour', e.target.value)}
          className="field-sm text-[11px] font-bold uppercase cursor-pointer"
        >
          <option value="">any</option>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{`${h.toString().padStart(2, '0')}:00`}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

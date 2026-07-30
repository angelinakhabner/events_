interface Props {
  /** Earliest Europe/Warsaw start hour (0–23), or null for any time. */
  selected: number | null;
  onChange: (next: number | null) => void;
}

interface Option {
  label: string;
  value: number | null;
}

// Presets cover how people actually narrow a listing — "after lunch", "after
// work", "evening" — rather than every hour. The trailing select covers the
// rest, so the common cases stay one click without capping the range.
const OPTIONS: Option[] = [
  { label: 'Any time', value: null },
  { label: 'After 12:00', value: 12 },
  { label: 'After 16:00', value: 16 },
  { label: 'After 18:00', value: 18 },
  { label: 'After 20:00', value: 20 },
];

const PRESET_HOURS = OPTIONS.map((o) => o.value).filter((v): v is number => v !== null);

export function TimeBar({ selected, onChange }: Props) {
  // A custom hour is shown in the select; a preset leaves the select blank so
  // the pressed chip is the only active-looking control.
  const customValue = selected !== null && !PRESET_HOURS.includes(selected) ? selected : '';

  return (
    <nav
      aria-label="Filter by start time"
      className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4 border-b border-rule"
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

      <label className="tag flex items-center gap-2 text-muted">
        From
        <select
          aria-label="Start time"
          value={customValue}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className={`bg-transparent border-b border-rule focus:border-accent outline-none py-1 ${
            customValue === '' ? 'text-muted' : 'text-accent'
          }`}
        >
          <option value="">any hour</option>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{`${h.toString().padStart(2, '0')}:00`}</option>
          ))}
        </select>
      </label>
    </nav>
  );
}

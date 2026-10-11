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

/** Same strip treatment as the date filter, plus a boxed select for the hours
 *  the presets don't cover. */
export function TimeBar({ selected, onChange }: Props) {
  // A custom hour is shown in the select; a preset leaves the select blank so
  // the pressed chip is the only active-looking control.
  const customValue = selected !== null && !PRESET_HOURS.includes(selected) ? selected : '';

  return (
    <nav
      aria-label="Filter by start time"
      className="flex scroll-x md:flex-wrap items-center gap-5 md:gap-7 py-3.5 md:py-[18px] rule-soft"
    >
      {OPTIONS.map((opt) => {
        const active = (opt.value ?? null) === (selected ?? null);
        return (
          <button
            key={opt.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`shrink-0 whitespace-nowrap bg-transparent border-0 p-0 cursor-pointer text-xs md:text-[13px] font-bold uppercase tracking-[1px] ${
              active ? 'text-accent' : 'text-muted hover:text-ink'
            }`}
          >
            {opt.label}
          </button>
        );
      })}

      <label className="tag flex shrink-0 items-center gap-2">
        From
        <select
          aria-label="Start time"
          value={customValue}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className={`border-2 border-ink bg-transparent px-2 py-1 text-[11px] font-bold uppercase tracking-[1px] cursor-pointer focus:outline-none focus:border-accent ${
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

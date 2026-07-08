import { warsawDayKey } from '../lib/buckets';

interface Props {
  /** Selected Europe/Warsaw day key (YYYY-MM-DD), or null for any day. */
  selected: string | null;
  onChange: (next: string | null) => void;
  now?: Date;
}

interface Option {
  label: string;
  value: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Today + 6 more days: matches the "this week" window of the event buckets,
// so every offered day can actually contain events.
const DAYS_SHOWN = 7;

const dayLabelFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw',
});

function buildOptions(now: Date): Option[] {
  const options: Option[] = [{ label: 'Any day', value: null }];
  for (let i = 0; i < DAYS_SHOWN; i++) {
    const d = new Date(now.getTime() + i * DAY_MS);
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayLabelFmt.format(d);
    options.push({ label, value: warsawDayKey(d) });
  }
  return options;
}

export function DayBar({ selected, onChange, now = new Date() }: Props) {
  return (
    <nav
      aria-label="Filter by day"
      className="flex flex-wrap gap-x-6 gap-y-3 py-4 border-b border-rule"
    >
      {buildOptions(now).map((opt) => {
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

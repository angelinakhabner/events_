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

/** The date strip under the category chips: bare uppercase labels, the
 *  selected one in accent red, closed by a light rule. */
export function DayBar({ selected, onChange, now = new Date() }: Props) {
  return (
    <nav
      aria-label="Filter by day"
      className="flex scroll-x md:flex-wrap gap-5 md:gap-7 py-3.5 md:py-[18px] rule-soft"
    >
      {buildOptions(now).map((opt) => {
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
    </nav>
  );
}

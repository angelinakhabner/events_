import { warsawDayKey, WEEK_DAYS, WEEK_FILTER, type DayFilter } from '../lib/buckets';
import { formatWeekdayDate } from '../lib/format';

interface Props {
  /** Selected day filter: a Warsaw day key, `WEEK_FILTER`, or null for any day. */
  selected: DayFilter;
  onChange: (next: DayFilter) => void;
  now?: Date;
}

interface Option {
  label: string;
  value: DayFilter;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The strip's options: any day, the two days that have their own names, the
 * whole week, then the rest of the week by date.
 *
 * "This week" sits with "Today" and "Tomorrow" rather than at the end because
 * it is the same kind of answer — a scope you can name — and it is the one
 * the listing itself heads a bucket with, so the strip can now select every
 * bucket the feed shows.
 */
function buildOptions(now: Date): Option[] {
  const options: Option[] = [
    { label: 'Any day', value: null },
    { label: 'Today', value: warsawDayKey(now) },
    { label: 'Tomorrow', value: warsawDayKey(new Date(now.getTime() + DAY_MS)) },
    { label: 'This week', value: WEEK_FILTER },
  ];
  // From the day after tomorrow to the end of the same seven-day window "This
  // week" covers, so every offered day is inside a scope the strip can also
  // select as a whole.
  for (let i = 2; i < WEEK_DAYS; i++) {
    const d = new Date(now.getTime() + i * DAY_MS);
    options.push({ label: formatWeekdayDate(d), value: warsawDayKey(d) });
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

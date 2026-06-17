import { useState } from 'react';
import { formatShortDate } from '../lib/format';
import type { DateRange } from '../lib/date-filter';

interface Props {
  value: DateRange;
  onChange: (next: DateRange) => void;
}

function btnClass(active: boolean): string {
  return `tag transition-colors ${active ? 'text-accent' : 'text-muted hover:text-ink'}`;
}

export function DateFilterBar({ value, onChange }: Props) {
  const [picking, setPicking] = useState(false);
  const isDate = value.kind === 'date';

  // Toggle behaviour: clicking the active quick-filter clears back to "all".
  function toggle(kind: 'today' | 'next3') {
    setPicking(false);
    onChange(value.kind === kind ? { kind: 'all' } : { kind });
  }

  return (
    <nav
      aria-label="Filter by date"
      className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4 border-b border-rule"
    >
      <button
        type="button"
        aria-pressed={value.kind === 'today'}
        onClick={() => toggle('today')}
        className={btnClass(value.kind === 'today')}
      >
        Today
      </button>
      <button
        type="button"
        aria-pressed={value.kind === 'next3'}
        onClick={() => toggle('next3')}
        className={btnClass(value.kind === 'next3')}
      >
        Next 3 days
      </button>
      <span className="inline-flex items-center gap-3">
        <button
          type="button"
          aria-pressed={isDate}
          onClick={() => setPicking((p) => !p)}
          className={btnClass(isDate || picking)}
        >
          {isDate ? formatShortDate(value.date) : 'Choose date'}
        </button>
        {picking ? (
          <input
            type="date"
            aria-label="Choose date"
            autoFocus
            value={isDate ? value.date : ''}
            onChange={(e) => {
              const d = e.target.value;
              onChange(d ? { kind: 'date', date: d } : { kind: 'all' });
              setPicking(false);
            }}
            className="text-sm border border-rule bg-paper px-2 py-1 text-ink"
          />
        ) : null}
      </span>
    </nav>
  );
}

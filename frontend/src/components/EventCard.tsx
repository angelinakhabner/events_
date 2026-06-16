import { useEffect, useRef, useState } from 'react';
import type { Event, Venue } from '@goin/shared';
import { categoryLabel, formatTime } from '../lib/format';
import { downloadIcs, googleCalendarUrl } from '../lib/calendar';
import { shareEvent, type ShareOutcome } from '../lib/share';

interface Props {
  event: Event;
  /** Fallback venue when `event.venue` isn't populated (mocks / older callers). */
  venue?: Venue;
}

export function EventCard({ event, venue }: Props) {
  const v = event.venue ?? venue;
  return (
    <article className="py-6">
      <div className="flex items-baseline gap-6">
        <div className="w-16 shrink-0 text-sm tabular-nums text-muted">
          {formatTime(event.startsAt)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-xl leading-snug">
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-ink hover:text-accent transition-colors no-underline"
            >
              {event.title}
            </a>
          </h3>
          <div className="mt-1 text-sm text-muted">
            {v?.name ?? 'Unknown venue'}
            {v ? <> · <span className="tag">{categoryLabel(v.category)}</span></> : null}
          </div>
          {event.description ? (
            <p className="mt-2 text-sm text-ink/70 line-clamp-2 max-w-prose">
              {event.description}
            </p>
          ) : null}
          <CardActions event={event} />
        </div>
      </div>
    </article>
  );
}

function CardActions({ event }: { event: Event }) {
  return (
    <div className="mt-3 flex items-center gap-5 text-sm">
      <AddToCalendar event={event} />
      <ShareButton event={event} />
    </div>
  );
}

function AddToCalendar({ event }: { event: Event }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape so the inline menu doesn't get stuck open.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0"
      >
        Add to calendar
      </button>
      {open ? (
        <div role="menu" className="absolute z-10 left-0 mt-2 bg-paper border border-rule p-2 min-w-[12rem]">
          <a
            role="menuitem"
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="block px-2 py-1 text-sm text-ink hover:text-accent no-underline"
          >
            Google Calendar
          </a>
          <button
            role="menuitem"
            type="button"
            onClick={() => { downloadIcs(event); setOpen(false); }}
            className="block w-full text-left px-2 py-1 text-sm text-ink hover:text-accent bg-transparent border-0 cursor-pointer"
          >
            Apple / Outlook (.ics)
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ShareButton({ event }: { event: Event }) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);

  // Auto-clear the small toast after a beat so it doesn't pile up.
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(() => setOutcome(null), 1800);
    return () => clearTimeout(t);
  }, [outcome]);

  const onClick = async () => {
    const result = await shareEvent(event);
    if (result !== 'cancelled') setOutcome(result);
  };

  const flash =
    outcome === 'copied' ? 'Link copied' :
    outcome === 'shared' ? 'Shared' :
    outcome === 'failed' ? "Couldn't share" :
    null;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0"
      >
        Share
      </button>
      {flash ? (
        <span role="status" aria-live="polite" className="text-xs text-muted">
          {flash}
        </span>
      ) : null}
    </span>
  );
}

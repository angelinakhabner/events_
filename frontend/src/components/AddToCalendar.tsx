import { useEffect, useRef, useState } from 'react';
import type { Event } from '@goin/shared';
import { downloadIcs, googleCalendarUrl } from '../lib/calendar';
import { formatShortDate, formatTime } from '../lib/format';

/**
 * "Add to calendar" — a button opening a two-item menu (Google, or an .ics for
 * Apple/Outlook). We deliberately don't pick a provider for the user: an .ics
 * download is useless to someone living in Google Calendar, and vice versa.
 *
 * Two shapes, same menu:
 *
 * - `text` — the labelled button on an event card's action row.
 * - `icon` — a compact glyph for the nearest-screenings panel, where it sits
 *   next to each individual time (GOI-48). A word per time would swamp a row
 *   like "KINOTEKA 14:00 18:00 21:00", so the affordance shrinks to an icon
 *   and moves its wording into the accessible name, which names the venue and
 *   time it will actually book.
 */
export function AddToCalendar({
  event,
  variant = 'text',
}: {
  event: Event;
  variant?: 'text' | 'icon';
}) {
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

  const icon = variant === 'icon';

  return (
    <div className="relative inline-flex" ref={wrapperRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={icon ? addToCalendarLabel(event) : undefined}
        title={icon ? addToCalendarLabel(event) : undefined}
        onClick={() => setOpen((v) => !v)}
        className={
          icon
            ? 'text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0 leading-none'
            : 'text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0'
        }
      >
        {icon ? <CalendarPlusIcon /> : 'Add to calendar'}
      </button>
      {open ? (
        // z-20 clears the nearest-screenings panel (z-10) this can open inside.
        <div role="menu" className="absolute z-20 left-0 top-full mt-2 bg-paper border border-rule p-2 min-w-[12rem]">
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

/** The icon button's accessible name. It has to say *which* showing it books,
 *  since a panel row carries several of them side by side. */
export function addToCalendarLabel(
  event: Pick<Event, 'title' | 'startsAt' | 'venue'>,
): string {
  const where = event.venue?.name;
  const when = `${formatShortDate(event.startsAt)} ${formatTime(event.startsAt)}`;
  return where
    ? `Add ${event.title} at ${where}, ${when}, to calendar`
    : `Add ${event.title}, ${when}, to calendar`;
}

/** A calendar page with a "+" — 12px, inherits colour from the button. */
function CalendarPlusIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      focusable="false"
      className="inline-block align-baseline"
    >
      <rect x="1.5" y="3" width="13" height="11.5" rx="1" />
      <path d="M1.5 6.5h13M5 1.5V4M11 1.5V4M8 8.5v4M6 10.5h4" />
    </svg>
  );
}

import type { Event } from '@goin/shared';

/** Two hours as a sensible default when an event has no end time or duration. */
const DEFAULT_DURATION_MIN = 120;

/** Compute the event's ends-at timestamp, falling back to start + duration
 *  or a 2-hour window when neither is present. */
export function eventEndsAt(event: Pick<Event, 'startsAt' | 'endsAt' | 'durationMinutes'>): Date {
  if (event.endsAt) return new Date(event.endsAt);
  const start = new Date(event.startsAt);
  const minutes = event.durationMinutes ?? DEFAULT_DURATION_MIN;
  return new Date(start.getTime() + minutes * 60_000);
}

/** YYYYMMDDTHHmmssZ — the basic-format ICS / Google Calendar wants. */
export function toBasicUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Build a Google Calendar "event template" URL — opens a pre-filled compose. */
export function googleCalendarUrl(
  event: Pick<Event, 'title' | 'description' | 'sourceUrl' | 'startsAt' | 'endsAt' | 'durationMinutes' | 'venue'>,
): string {
  const start = toBasicUtc(new Date(event.startsAt));
  const end = toBasicUtc(eventEndsAt(event));
  const details = [event.description, event.sourceUrl].filter(Boolean).join('\n\n');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${start}/${end}`,
    details,
  });
  if (event.venue?.name) params.set('location', event.venue.name);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Escape a string for an iCalendar TEXT property per RFC 5545 §3.3.11. */
export function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Build an .ics (iCalendar) document for one event. Suitable for Apple
 *  Calendar, Outlook, and "import" flows in Google Calendar. */
export function buildIcs(
  event: Pick<Event, 'id' | 'title' | 'description' | 'sourceUrl' | 'startsAt' | 'endsAt' | 'durationMinutes' | 'venue'>,
  options: { now?: Date } = {},
): string {
  const now = options.now ?? new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Goin//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:goin-${event.id}@goin.app`,
    `DTSTAMP:${toBasicUtc(now)}`,
    `DTSTART:${toBasicUtc(new Date(event.startsAt))}`,
    `DTEND:${toBasicUtc(eventEndsAt(event))}`,
    `SUMMARY:${icsEscape(event.title)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  if (event.venue?.name) lines.push(`LOCATION:${icsEscape(event.venue.name)}`);
  lines.push(`URL:${event.sourceUrl}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  // RFC 5545 wants CRLF between lines.
  return lines.join('\r\n');
}

/** Trigger a download of the event as an .ics file. */
export function downloadIcs(
  event: Pick<Event, 'id' | 'title' | 'description' | 'sourceUrl' | 'startsAt' | 'endsAt' | 'durationMinutes' | 'venue'>,
): void {
  const blob = new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugifyForFilename(event.title)}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Free the blob next tick so the click handler can use it first.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function slugifyForFilename(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .toLowerCase()
    .slice(0, 60) || 'event';
}

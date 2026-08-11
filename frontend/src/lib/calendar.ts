import { isExhibition, type Event } from '@afisz/shared';
import { downloadText, slugifyForFilename } from './download';

/** Two hours as a sensible default when an event has no end time or duration. */
const DEFAULT_DURATION_MIN = 120;

const TZ = 'Europe/Warsaw';
const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** YYYYMMDD in Warsaw — the DATE-valued form both Google and RFC 5545 use for
 *  all-day entries. Formatted in the venue's zone, not the viewer's, or a run
 *  opening on the 12th lands on the 11th for anyone west of it. */
export function toBasicDate(d: Date): string {
  return dayFmt.format(d).replace(/-/g, '');
}

/** One day later, for the exclusive end date an all-day range wants. */
function nextDay(d: Date): Date {
  return new Date(d.getTime() + 86_400_000);
}

/**
 * An exhibition's calendar entry is an all-day range, not a 2-hour slot
 * (GOI-67): it is on from its opening date to its closing date, and putting
 * it in someone's diary at 00:00–02:00 on the opening day says the opposite.
 * Both formats take the end date as *exclusive*, hence the extra day.
 */
export function allDayRange(
  event: Pick<Event, 'startsAt' | 'endsAt' | 'kind'>,
): { start: string; end: string } | null {
  if (!isExhibition(event)) return null;
  const start = new Date(event.startsAt);
  if (Number.isNaN(start.getTime())) return null;
  const endSource = event.endsAt ? new Date(event.endsAt) : start;
  const end = Number.isNaN(endSource.getTime()) ? start : endSource;
  return { start: toBasicDate(start), end: toBasicDate(nextDay(end)) };
}

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
  event: Pick<Event, 'title' | 'description' | 'sourceUrl' | 'startsAt' | 'endsAt' | 'durationMinutes' | 'venue' | 'kind'>,
): string {
  const allDay = allDayRange(event);
  const start = allDay ? allDay.start : toBasicUtc(new Date(event.startsAt));
  const end = allDay ? allDay.end : toBasicUtc(eventEndsAt(event));
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
  event: Pick<Event, 'id' | 'title' | 'description' | 'sourceUrl' | 'startsAt' | 'endsAt' | 'durationMinutes' | 'venue' | 'kind'>,
  options: { now?: Date } = {},
): string {
  const now = options.now ?? new Date();
  const allDay = allDayRange(event);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Goin//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:goin-${event.id}@goin.app`,
    `DTSTAMP:${toBasicUtc(now)}`,
    // VALUE=DATE is what makes a client file it as all-day rather than as a
    // midnight appointment (RFC 5545 §3.3.4).
    ...(allDay
      ? [`DTSTART;VALUE=DATE:${allDay.start}`, `DTEND;VALUE=DATE:${allDay.end}`]
      : [`DTSTART:${toBasicUtc(new Date(event.startsAt))}`, `DTEND:${toBasicUtc(eventEndsAt(event))}`]),
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
  event: Pick<Event, 'id' | 'title' | 'description' | 'sourceUrl' | 'startsAt' | 'endsAt' | 'durationMinutes' | 'venue' | 'kind'>,
): void {
  downloadText(`${slugifyForFilename(event.title, 'event')}.ics`, buildIcs(event), 'text/calendar');
}

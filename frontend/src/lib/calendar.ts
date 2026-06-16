import type { Event, Venue } from '@goin/shared';

const DEFAULT_DURATION_MIN = 120;

/** Resolved start/end for an event, with a sensible fallback end time. */
export interface CalendarTimes {
  start: Date;
  end: Date;
}

export function calendarTimes(event: Event): CalendarTimes {
  const start = new Date(event.startsAt);
  let end: Date;
  if (event.endsAt) {
    end = new Date(event.endsAt);
  } else if (event.durationMinutes && event.durationMinutes > 0) {
    end = new Date(start.getTime() + event.durationMinutes * 60_000);
  } else {
    end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60_000);
  }
  return { start, end };
}

/** UTC timestamp in iCalendar basic format: YYYYMMDDTHHMMSSZ. */
export function toCalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function eventLocation(venue: Venue | undefined): string {
  if (!venue) return '';
  return [venue.name, venue.city, venue.country].filter(Boolean).join(', ');
}

function eventDescription(event: Event, venue: Venue | undefined): string {
  const parts: string[] = [];
  if (event.description) parts.push(event.description);
  if (venue) parts.push(`Venue: ${eventLocation(venue)}`);
  if (event.sourceUrl) parts.push(`More info: ${event.sourceUrl}`);
  return parts.join('\n\n');
}

/** A Google Calendar "add event" URL that opens a pre-filled event template. */
export function googleCalendarUrl(event: Event, venue: Venue | undefined): string {
  const { start, end } = calendarTimes(event);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toCalDate(start)}/${toCalDate(end)}`,
    details: eventDescription(event, venue),
    location: eventLocation(venue),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Escape a value for an iCalendar text field (RFC 5545 §3.3.11). */
function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Build an iCalendar (.ics) document for a single event. */
export function buildIcs(event: Event, venue: Venue | undefined, now: Date = new Date()): string {
  const { start, end } = calendarTimes(event);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Goin//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@goin`,
    `DTSTAMP:${toCalDate(now)}`,
    `DTSTART:${toCalDate(start)}`,
    `DTEND:${toCalDate(end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(eventDescription(event, venue))}`,
    `LOCATION:${escapeIcs(eventLocation(venue))}`,
    `URL:${event.sourceUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

/** Safe filename for the downloaded .ics, e.g. "perfect-days.ics". */
export function icsFilename(event: Event): string {
  const slug = event.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'event'}.ics`;
}

/** Trigger a client-side download of the event's .ics file. */
export function downloadIcs(event: Event, venue: Venue | undefined): void {
  const blob = new Blob([buildIcs(event, venue)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = icsFilename(event);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Playful invitation copy used for the share action. */
export function invitationText(event: Event, venue: Venue | undefined): string {
  const where = venue ? ` at ${venue.name}` : '';
  return `I invite you to share "${event.title}"${where} with me. Want to come?`;
}

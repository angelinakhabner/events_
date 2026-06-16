import { describe, it, expect } from 'vitest';
import type { Event, Venue } from '@goin/shared';
import {
  buildIcs,
  calendarTimes,
  googleCalendarUrl,
  icsFilename,
  invitationText,
  toCalDate,
} from './calendar';

const venue: Venue = {
  id: 'v', name: 'Kino X', url: 'https://x', city: 'Warsaw', country: 'Poland',
  category: 'cinema', language: 'pl', timezone: 'Europe/Warsaw', createdAt: '',
};

const event: Event = {
  id: 'e1', venueId: 'v', title: 'Perfect Days', description: 'A film, about routines.',
  startsAt: '2026-06-01T18:00:00.000Z', endsAt: null, durationMinutes: 124, director: null, cast: [],
  category: 'cinema', language: 'pl',
  priceMin: 28, priceMax: 32, sourceUrl: 'https://example.com/e1', sourceId: null, scrapedAt: '',
};

describe('toCalDate', () => {
  it('formats a UTC date in iCalendar basic format', () => {
    expect(toCalDate(new Date('2026-06-01T18:00:00.000Z'))).toBe('20260601T180000Z');
  });
});

describe('calendarTimes', () => {
  it('uses durationMinutes for the end when endsAt is missing', () => {
    const { start, end } = calendarTimes(event);
    expect(start.toISOString()).toBe('2026-06-01T18:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-01T20:04:00.000Z');
  });

  it('prefers an explicit endsAt', () => {
    const { end } = calendarTimes({ ...event, endsAt: '2026-06-01T19:30:00.000Z' });
    expect(end.toISOString()).toBe('2026-06-01T19:30:00.000Z');
  });

  it('falls back to a 2h default when no duration or end', () => {
    const { end } = calendarTimes({ ...event, endsAt: null, durationMinutes: null });
    expect(end.toISOString()).toBe('2026-06-01T20:00:00.000Z');
  });
});

describe('googleCalendarUrl', () => {
  it('builds a TEMPLATE url with title, dates and location', () => {
    const url = googleCalendarUrl(event, venue);
    expect(url).toContain('https://calendar.google.com/calendar/render');
    expect(url).toContain('action=TEMPLATE');
    expect(url).toContain('text=Perfect+Days');
    expect(url).toContain('dates=20260601T180000Z%2F20260601T200400Z');
    expect(url).toContain('location=Kino+X%2C+Warsaw%2C+Poland');
  });
});

describe('buildIcs', () => {
  it('produces a valid VEVENT with escaped fields and CRLF lines', () => {
    const ics = buildIcs(event, venue, new Date('2026-05-01T00:00:00.000Z'));
    expect(ics).toContain('\r\n');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:e1@goin');
    expect(ics).toContain('DTSTART:20260601T180000Z');
    expect(ics).toContain('DTEND:20260601T200400Z');
    expect(ics).toContain('SUMMARY:Perfect Days');
    // comma in the description must be escaped
    expect(ics).toContain('A film\\, about routines.');
    expect(ics).toContain('URL:https://example.com/e1');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});

describe('icsFilename', () => {
  it('slugifies the title', () => {
    expect(icsFilename(event)).toBe('perfect-days.ics');
    expect(icsFilename({ ...event, title: '   ' })).toBe('event.ics');
  });
});

describe('invitationText', () => {
  it('frames the share as an invitation including the venue', () => {
    expect(invitationText(event, venue)).toBe(
      'I invite you to share "Perfect Days" at Kino X with me. Want to come?',
    );
  });

  it('omits the venue when unknown', () => {
    expect(invitationText(event, undefined)).toBe(
      'I invite you to share "Perfect Days" with me. Want to come?',
    );
  });
});

import { describe, it, expect } from 'vitest';
import type { Event } from '@goin/shared';
import { buildIcs, eventEndsAt, googleCalendarUrl, icsEscape, toBasicUtc } from './calendar';

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-1',
    venueId: 'v-1',
    venue: { id: 'v-1', name: 'Kino Muranów', category: 'cinema', city: 'Warsaw', country: 'PL' },
    title: 'Perfect Days',
    description: 'A film about a Tokyo toilet cleaner.',
    startsAt: '2026-06-15T16:30:00.000Z',
    endsAt: null,
    category: 'cinema',
    language: 'pl',
    director: null,
    cast: [],
    durationMinutes: 124,
    priceMin: null,
    priceMax: null,
    sourceUrl: 'https://kinomuranow.pl/film/perfect-days',
    sourceId: '26919',
    scrapedAt: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('eventEndsAt', () => {
  it('uses endsAt when present', () => {
    expect(eventEndsAt(event({ endsAt: '2026-06-15T19:00:00.000Z' })).toISOString())
      .toBe('2026-06-15T19:00:00.000Z');
  });

  it('falls back to startsAt + durationMinutes', () => {
    const e = event({ endsAt: null, durationMinutes: 90 });
    expect(eventEndsAt(e).toISOString()).toBe('2026-06-15T18:00:00.000Z');
  });

  it('falls back to a 2-hour window when neither is present', () => {
    const e = event({ endsAt: null, durationMinutes: null });
    expect(eventEndsAt(e).toISOString()).toBe('2026-06-15T18:30:00.000Z');
  });
});

describe('toBasicUtc', () => {
  it('formats as YYYYMMDDTHHmmssZ', () => {
    expect(toBasicUtc(new Date('2026-06-15T16:30:00.000Z'))).toBe('20260615T163000Z');
  });
});

describe('googleCalendarUrl', () => {
  it('includes all the key params', () => {
    const url = googleCalendarUrl(event());
    expect(url).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?/);
    expect(url).toContain('action=TEMPLATE');
    expect(url).toContain('text=Perfect+Days');
    expect(url).toContain('dates=20260615T163000Z%2F20260615T183400Z'); // +124 min
    // URLSearchParams uses '+' for spaces; decodeURIComponent keeps it as-is.
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('location=Kino+Muranów');
    expect(decoded).toContain('A+film+about+a+Tokyo+toilet+cleaner.');
    expect(decoded).toContain('https://kinomuranow.pl/film/perfect-days');
  });

  it('omits location when no venue is attached', () => {
    const url = googleCalendarUrl(event({ venue: undefined }));
    expect(url).not.toContain('location=');
  });
});

describe('icsEscape', () => {
  it('escapes RFC 5545 special characters', () => {
    expect(icsEscape('Hello, World; line1\nline2\\back')).toBe(
      'Hello\\, World\\; line1\\nline2\\\\back',
    );
  });
});

describe('buildIcs', () => {
  it('produces a well-formed VCALENDAR with VEVENT inside', () => {
    const out = buildIcs(event(), { now: new Date('2026-06-14T00:00:00.000Z') });
    expect(out).toContain('BEGIN:VCALENDAR');
    expect(out).toContain('VERSION:2.0');
    expect(out).toContain('BEGIN:VEVENT');
    expect(out).toContain('END:VEVENT');
    expect(out).toContain('END:VCALENDAR');
    expect(out).toContain('UID:goin-evt-1@goin.app');
    expect(out).toContain('DTSTART:20260615T163000Z');
    expect(out).toContain('DTEND:20260615T183400Z');
    expect(out).toContain('DTSTAMP:20260614T000000Z');
    expect(out).toContain('SUMMARY:Perfect Days');
    expect(out).toContain('LOCATION:Kino Muranów');
    expect(out).toContain('URL:https://kinomuranow.pl/film/perfect-days');
  });

  it('escapes commas and newlines in description', () => {
    const out = buildIcs(event({ description: 'Comma, then\na newline.' }), { now: new Date('2026-06-14T00:00:00.000Z') });
    expect(out).toContain('DESCRIPTION:Comma\\, then\\na newline.');
  });

  it('uses CRLF line endings', () => {
    const out = buildIcs(event(), { now: new Date('2026-06-14T00:00:00.000Z') });
    expect(out.includes('\r\n')).toBe(true);
    // sanity: there should be no lone \n
    expect(out.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });
});

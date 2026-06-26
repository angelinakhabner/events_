import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseKinotekaListing,
  pickDatesWithinWindow,
  extractActiveDate,
  tzOffsetAt,
  toStartsAt,
  scrapeKinoteka,
} from './kinoteka.js';
import { validateEvents } from '../validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');
const TZ = 'Europe/Warsaw';

let html = '';
beforeAll(async () => {
  html = await fs.readFile(path.join(fixtureDir, 'kinoteka-repertuar.html'), 'utf-8');
});

describe('tzOffsetAt', () => {
  it('returns +02:00 for Warsaw in summer (CEST)', () => {
    expect(tzOffsetAt(new Date('2026-06-26T12:00:00Z'), TZ)).toBe('+02:00');
  });
  it('returns +01:00 for Warsaw in winter (CET)', () => {
    expect(tzOffsetAt(new Date('2026-01-15T12:00:00Z'), TZ)).toBe('+01:00');
  });
});

describe('toStartsAt', () => {
  it('combines data-day + data-hour with the real Warsaw offset', () => {
    expect(toStartsAt('2026-06-26', '20:00', TZ)).toBe('2026-06-26T20:00:00+02:00');
    expect(toStartsAt('2026-01-15', '20:00', TZ)).toBe('2026-01-15T20:00:00+01:00');
  });
  it('pads a single-digit hour', () => {
    expect(toStartsAt('2026-06-26', '9:30', TZ)).toBe('2026-06-26T09:30:00+02:00');
  });
  it('rejects malformed day/hour', () => {
    expect(toStartsAt('26-06-2026', '20:00', TZ)).toBeNull();
    expect(toStartsAt('2026-06-26', 'evening', TZ)).toBeNull();
  });
});

describe('parseKinotekaListing', () => {
  it('extracts one event per screening with the real showtime (not the +00:00 <time>)', () => {
    const events = parseKinotekaListing(html, TZ);
    // Ojczyzna has 2 screenings, Toy Story 1 → 3 total.
    expect(events).toHaveLength(3);

    const ojczyzna = events.filter((e) => e.title === 'Ojczyzna');
    expect(ojczyzna.map((e) => e.starts_at).sort()).toEqual([
      '2026-06-26T13:30:00+02:00',
      '2026-06-26T19:00:00+02:00',
    ]);
    // Crucially NOT midnight / +00:00 from the <time datetime> trap.
    expect(events.every((e) => !e.starts_at.endsWith('T00:00:00+00:00'))).toBe(true);
  });

  it('uses the per-film page as source_url and data-eventid as source_id', () => {
    const [first] = parseKinotekaListing(html, TZ);
    expect(first!.source_url).toBe('https://kinoteka.pl/film/ojczyzna/');
    expect(first!.source_id).toBe('95dd2073-e644-4930-9b11-20bd123cdc63');
  });

  it('fills description inline from data-description', () => {
    const toy = parseKinotekaListing(html, TZ).find((e) => e.title.startsWith('Toy Story'));
    expect(toy!.description).toContain('Kowboj Chudy');
  });

  it('produces rows that all pass the cinema validator (no midnight drops)', () => {
    const { valid, invalid } = validateEvents(parseKinotekaListing(html, TZ), {
      category: 'cinema',
      timezone: TZ,
    });
    expect(invalid).toHaveLength(0);
    expect(valid).toHaveLength(3);
  });
});

describe('day-picker helpers', () => {
  it('reads the active date from the picker', () => {
    expect(extractActiveDate(html)).toBe('2026-06-26');
  });

  it('keeps only picker dates inside [today, today+windowDays]', () => {
    const today = new Date('2026-06-26T08:00:00Z'); // Fri 26 Jun, Warsaw
    // 7-day window → through 2026-07-03, so 06-26 and 06-27 qualify, 07-10 does not.
    expect(pickDatesWithinWindow(html, today, 7, TZ)).toEqual(['2026-06-26', '2026-06-27']);
    // Wider window pulls in the far date too.
    expect(pickDatesWithinWindow(html, today, 30, TZ)).toEqual([
      '2026-06-26',
      '2026-06-27',
      '2026-07-10',
    ]);
  });
});

describe('scrapeKinoteka (multi-day)', () => {
  it('follows ?date= links, reuses the base page, and dedupes', async () => {
    // Build a second day's page by relabelling the fixture's screenings to 06-27.
    const day27 = html.replace(/2026-06-26/g, '2026-06-27').replace(/data-eventid="([^"]+)"/g, 'data-eventid="$1-27"');

    const fetcher = (async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = url.includes('date=2026-06-27') ? day27 : html;
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeKinoteka({
      baseUrl: 'https://kinoteka.pl/repertuar/',
      today: new Date('2026-06-26T08:00:00Z'),
      windowDays: 7,
      timezone: TZ,
      fetcher,
    });

    // 3 screenings on 06-26 (base/active) + 3 on 06-27 = 6, no dupes.
    expect(res.events).toHaveLength(6);
    const days = new Set(res.events.map((e) => e.starts_at.slice(0, 10)));
    expect([...days].sort()).toEqual(['2026-06-26', '2026-06-27']);
    expect(res.signature).toContain('2026-06-26');
    expect(res.signature).toContain('2026-06-27');
  });
});

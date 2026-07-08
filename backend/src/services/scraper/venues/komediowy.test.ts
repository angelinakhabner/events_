import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseKomediowyListing,
  extractMonthNav,
  monthRange,
  toIsoDay,
  parsePrice,
  scrapeKomediowy,
} from './komediowy.js';
import { validateEvents } from '../validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');
const TZ = 'Europe/Warsaw';

// Live capture of https://komediowy.pl/repertuar/ (July 2026): 64 events
// across 25 open days, one calendar month per page.
let html = '';
beforeAll(async () => {
  html = await fs.readFile(path.join(fixtureDir, 'komediowy-repertuar.html'), 'utf-8');
});

describe('toIsoDay', () => {
  it('converts the calendar day format', () => {
    expect(toIsoDay('01.07.2026')).toBe('2026-07-01');
    expect(toIsoDay(' 31.12.2026 ')).toBe('2026-12-31');
  });
  it('rejects other shapes', () => {
    expect(toIsoDay('2026-07-01')).toBeNull();
    expect(toIsoDay('1.7.2026')).toBeNull();
    expect(toIsoDay('')).toBeNull();
  });
});

describe('parsePrice', () => {
  it('reads single prices, with or without the mobile prefix', () => {
    expect(parsePrice('75 zł')).toEqual({ min: 75, max: 75 });
    expect(parsePrice(' / 75 zł')).toEqual({ min: 75, max: 75 });
    expect(parsePrice('1200 zł')).toEqual({ min: 1200, max: 1200 });
  });
  it('reads ranges', () => {
    expect(parsePrice('50-70 zł')).toEqual({ min: 50, max: 70 });
  });
  it('treats free wording as an explicit 0 and no number as unknown', () => {
    expect(parsePrice('wstęp wolny')).toEqual({ min: 0, max: 0 });
    expect(parsePrice('Bezpłatne')).toEqual({ min: 0, max: 0 });
    expect(parsePrice('')).toEqual({ min: null, max: null });
  });
});

describe('parseKomediowyListing', () => {
  it('extracts every screening of the month with real local times', () => {
    const events = parseKomediowyListing(html, TZ);
    expect(events).toHaveLength(64);
    // July → CEST; and no midnight-default rows.
    expect(events.every((e) => e.starts_at.endsWith('+02:00'))).toBe(true);
    expect(events.every((e) => !e.starts_at.includes('T00:00'))).toBe(true);
  });

  it('reads title, time, price, detail page and per-screening tixto id', () => {
    const [first] = parseKomediowyListing(html, TZ);
    expect(first!.title).toBe('Rozmowa o pracę: work-life balance, czyli WAKACJE POD MAILEM');
    expect(first!.starts_at).toBe('2026-07-01T19:00:00+02:00');
    expect(first!.price_min).toBe(75);
    expect(first!.price_max).toBe(75);
    expect(first!.source_url).toBe('https://komediowy.pl/spektakl/rozmowa-o-prace/');
    expect(first!.source_id).toBe('tixto:3503');
  });

  it('leaves source_id null when the ticket link is not a per-screening one', () => {
    const events = parseKomediowyListing(html, TZ);
    const odd = events.filter((e) => e.source_id === null);
    // Exactly one July event links a tixto event page instead of /s/<id>.
    expect(odd).toHaveLength(1);
    expect(odd[0]!.title).toContain('Dubbingi niszczą');
    // Everything else got a unique per-screening id.
    const ids = events.map((e) => e.source_id).filter(Boolean);
    expect(new Set(ids).size).toBe(63);
  });

  it('produces rows that all pass the comedy validator (no midnight drops)', () => {
    const { valid, invalid } = validateEvents(parseKomediowyListing(html, TZ), {
      category: 'comedy',
      timezone: TZ,
    });
    expect(invalid).toHaveLength(0);
    expect(valid).toHaveLength(64);
  });
});

describe('extractMonthNav', () => {
  it('reads prev/next arrow months and the active month from the event days', () => {
    expect(extractMonthNav(html)).toEqual({ prev: '2026-06', next: '2026-08', active: '2026-07' });
  });
  it('falls back to the arrows when a month has no events', () => {
    const noDays = html.replace(/data-event-date=/g, 'data-x=');
    expect(extractMonthNav(noDays).active).toBe('2026-07');
  });
});

describe('monthRange', () => {
  it('lists months inclusively, crossing year ends', () => {
    expect(monthRange('2026-07', '2026-07')).toEqual(['2026-07']);
    expect(monthRange('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('scrapeKomediowy (multi-month)', () => {
  it('follows /repertuar/YYYY-MM for further months and trims to the window', async () => {
    // Build an August page by relabelling the fixture's days and tixto ids.
    const august = html
      .replace(/(\d{2})\.07\.2026/g, '$1.08.2026')
      .replace(/tixto\.pl\/s\/(\d+)/g, 'tixto.pl/s/9$1');

    const requested: string[] = [];
    const fetcher = (async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      requested.push(url);
      return new Response(url.includes('/2026-08') ? august : html, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeKomediowy({
      baseUrl: 'https://komediowy.pl/repertuar/',
      today: new Date('2026-07-25T08:00:00Z'),
      windowDays: 21, // comedy window → through 2026-08-15
      timezone: TZ,
      fetcher,
    });

    // One GET for the base month, one for August — and never a refetch of July.
    expect(requested).toEqual([
      'https://komediowy.pl/repertuar/',
      'https://komediowy.pl/repertuar/2026-08',
    ]);

    // July keeps only days 25-31 (12 events); August days 01-15 (in the
    // relabelled fixture: the same day-of-month spread → 33 events).
    const days = res.events.map((e) => e.starts_at.slice(0, 10));
    expect(days.every((d) => d >= '2026-07-25' && d <= '2026-08-15')).toBe(true);
    expect(days.filter((d) => d.startsWith('2026-07')).length).toBe(12);
    expect(days.filter((d) => d.startsWith('2026-08')).length).toBe(33);

    expect(res.signature).toContain('2026-07');
    expect(res.signature).toContain('2026-08');
  });

  it('survives a failed month page (keeps what it has)', async () => {
    const fetcher = (async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/2026-08')) return new Response('nope', { status: 500 });
      return new Response(html, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeKomediowy({
      baseUrl: 'https://komediowy.pl/repertuar/',
      today: new Date('2026-07-25T08:00:00Z'),
      windowDays: 21,
      timezone: TZ,
      fetcher,
    });
    expect(res.events).toHaveLength(12); // July tail only
  });
});

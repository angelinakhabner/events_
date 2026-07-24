import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrWarszawaListing, parseHourRange, monthUrl, scrapeTrWarszawa } from './trwarszawa.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');

const loadFixture = (name: string) => fs.readFile(path.join(fixtureDir, name), 'utf-8');

const JULY_URL = 'https://trwarszawa.pl/kalendarz/2026/07/?view=calendar';

describe('parseHourRange', () => {
  it('parses start + running time from a range', () => {
    expect(parseHourRange('20:00-21:10')).toEqual({ start: '20:00', durationMinutes: 70 });
  });
  it('parses a bare start time', () => {
    expect(parseHourRange('19:30')).toEqual({ start: '19:30', durationMinutes: null });
  });
  it('handles a past-midnight end', () => {
    expect(parseHourRange('23:30-0:40')).toEqual({ start: '23:30', durationMinutes: 70 });
  });
  it('rejects garbage', () => {
    expect(parseHourRange('sobota')).toBeNull();
  });
});

describe('monthUrl', () => {
  it('swaps the /kalendarz/YYYY/MM/ segment', () => {
    expect(monthUrl(JULY_URL, '2026-09')).toBe('https://trwarszawa.pl/kalendarz/2026/09/?view=calendar');
  });
  it('returns null when the URL has no month segment', () => {
    expect(monthUrl('https://trwarszawa.pl/repertuar/', '2026-09')).toBeNull();
  });
});

describe('parseTrWarszawaListing', () => {
  it('parses the July calendar (summer break month with a lone premiere)', async () => {
    const html = await loadFixture('trwarszawa.pl-kalendarz-2026-07-view-calendar.html');
    const events = parseTrWarszawaListing(html);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const premiere = events.find((e) => e.source_url.includes('only-love-can-break-your-heart'))!;
    expect(premiere).toBeDefined();
    expect(premiere.title).toBe('only Love can break your Heart');
    expect(premiere.starts_at).toBe('2026-07-03T20:00:00+02:00');
    expect(premiere.duration_minutes).toBe(70);
    expect(premiere.description).toContain('Premiera');
    expect(premiere.description).toContain('Scena: Marszałkowska 8');
  });
});

describe('parseTrWarszawaListing — September (full season month)', () => {
  it('parses a dense month: many performances, all timezone-stamped', async () => {
    const html = await loadFixture('trwarszawa.pl-kalendarz-2026-09-view-calendar.html');
    const events = parseTrWarszawaListing(html);

    expect(events.length).toBeGreaterThan(10);
    for (const e of events) {
      expect(e.starts_at).toMatch(/^2026-(08|09|10)-\d{2}T\d{2}:\d{2}:00\+02:00$/);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.source_url).toMatch(/^https:\/\/trwarszawa\.pl\//);
    }
    // September in Warsaw is CEST (+02:00) and the month grid carries real
    // per-day cells — sanity-check the spread.
    const days = new Set(events.map((e) => e.starts_at.slice(0, 10)));
    expect(days.size).toBeGreaterThan(5);
  });
});

describe('scrapeTrWarszawa', () => {
  it('fetches each month page in the window and filters rows to it', async () => {
    const july = await loadFixture('trwarszawa.pl-kalendarz-2026-07-view-calendar.html');
    const fetched: string[] = [];
    const fakeFetch = (async (url: string | URL) => {
      fetched.push(String(url));
      const body = String(url).includes('/2026/07/') ? july : '<html><body></body></html>';
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeTrWarszawa({
      baseUrl: JULY_URL,
      today: new Date('2026-07-01T08:00:00.000Z'),
      windowDays: 45, // ends 15.08 → July and August pages
      fetcher: fakeFetch,
    });

    expect(fetched).toEqual([
      'https://trwarszawa.pl/kalendarz/2026/07/?view=calendar',
      'https://trwarszawa.pl/kalendarz/2026/08/?view=calendar',
    ]);
    expect(res.events.map((e) => e.starts_at.slice(0, 10))).toContain('2026-07-03');
    expect(res.signature).toContain('/2026/07/');
  });
});

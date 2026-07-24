import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEditoListing, parseDateCell, monthUrl, monthRange, scrapeEdito } from './edito.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');

const loadFixture = (name: string) => fs.readFile(path.join(fixtureDir, name), 'utf-8');

const MNW_JULY = 'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/07-2026,lista,miesiac.html';
const KROLIKARNIA = 'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/';

describe('parseDateCell', () => {
  it('parses date + time', () => {
    expect(parseDateCell('  2026-07-05    /   11:00 ')).toEqual({ day: '2026-07-05', hour: '11:00' });
  });
  it('parses a bare date (all-day exhibition rows)', () => {
    expect(parseDateCell(' 2026-07-05 ')).toEqual({ day: '2026-07-05', hour: null });
  });
  it('rejects garbage', () => {
    expect(parseDateCell('lipiec 2026')).toBeNull();
  });
});

describe('monthUrl / monthRange', () => {
  it('swaps the MM-YYYY segment', () => {
    expect(monthUrl(MNW_JULY, '2026-08')).toBe(
      'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/08-2026,lista,miesiac.html',
    );
  });
  it('returns null for URLs without a month segment', () => {
    expect(monthUrl(KROLIKARNIA, '2026-08')).toBeNull();
  });
  it('walks months across a year boundary', () => {
    expect(monthRange('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('parseEditoListing', () => {
  it('parses the MNW July month list: real dates/times, per-event links, ids', async () => {
    const html = await loadFixture('mnw.art.pl-wydarzenia-kalendarz-wydarzen-07-2026-lista-miesiac.html.html');
    const events = parseEditoListing(html, MNW_JULY);

    expect(events.length).toBeGreaterThan(30);
    const first = events[0]!;
    expect(first.title).toContain('Qigong');
    expect(first.starts_at).toBe('2026-07-01T10:30:00+02:00');
    expect(first.source_url).toBe('https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/9144,wydarzenie.html');
    expect(first.source_id).toBe('edito:9144:2026-07-01');
    expect(first.description).toMatch(/prozdrowotne/);

    for (const e of events) {
      expect(e.starts_at.slice(0, 7)).toBe('2026-07');
      expect(new URL(e.source_url).hostname).toBe('mnw.art.pl'); // branch rows dropped
    }
  });

  it('parses the Królikarnia calendar page', async () => {
    const html = await loadFixture('krolikarnia.mnw.art.pl-wydarzenia-kalendarz-wydarzen.html');
    const events = parseEditoListing(html, KROLIKARNIA);

    expect(events.length).toBeGreaterThanOrEqual(5);
    const brzask = events.find((e) => e.source_url.includes('2663,'));
    expect(brzask?.starts_at).toBe('2026-07-05T11:00:00+02:00');
    for (const e of events) {
      expect(new URL(e.source_url).hostname).toBe('krolikarnia.mnw.art.pl');
    }
  });

  it('a recurring event id stays unique per date', async () => {
    const html = await loadFixture('mnw.art.pl-wydarzenia-kalendarz-wydarzen-07-2026-lista-miesiac.html.html');
    const events = parseEditoListing(html, MNW_JULY);
    const ids = events.map((e) => e.source_id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('scrapeEdito', () => {
  it('fetches every month page covering the window and filters rows to it', async () => {
    const july = await loadFixture('mnw.art.pl-wydarzenia-kalendarz-wydarzen-07-2026-lista-miesiac.html.html');
    const fetched: string[] = [];
    const fakeFetch = (async (url: string | URL) => {
      fetched.push(String(url));
      // August page: pretend it's empty of events.
      const body = String(url).includes('07-2026') ? july : '<html><body></body></html>';
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeEdito({
      baseUrl: MNW_JULY,
      today: new Date('2026-07-12T08:00:00.000Z'),
      windowDays: 60, // window ends 2026-09-10 → July, August, September pages
      fetcher: fakeFetch,
    });

    expect(fetched).toEqual([
      'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/07-2026,lista,miesiac.html',
      'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/08-2026,lista,miesiac.html',
      'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/09-2026,lista,miesiac.html',
    ]);
    // Only July 12+ rows survive the window filter.
    expect(res.events.length).toBeGreaterThan(0);
    for (const e of res.events) {
      expect(e.starts_at.slice(0, 10) >= '2026-07-12').toBe(true);
    }
    expect(res.signature).toContain('07-2026');
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNowyTeatrMonth, scrapeNowyTeatr } from './nowyteatr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');

const loadFixture = (name: string) => fs.readFile(path.join(fixtureDir, name), 'utf-8');

const SEPTEMBER = 'nowyteatr.org-pl-kalendarz-date_from-2026-09-01-date_to-2026-09-30.html';

describe('parseNowyTeatrMonth', () => {
  it('parses the September agenda: timed performances only, day numbers anchored to the month', async () => {
    const html = await loadFixture(SEPTEMBER);
    const events = parseNowyTeatrMonth(html, '2026-09');

    expect(events.length).toBeGreaterThanOrEqual(1);
    const kofman = events.find((e) => e.source_url.includes('kofman-podwojne-wiazanie'))!;
    expect(kofman).toBeDefined();
    expect(kofman.title).toContain('Kofman');
    expect(kofman.starts_at).toBe('2026-09-05T19:00:00+02:00'); // <time datetime="19.00">

    for (const e of events) {
      expect(e.starts_at.slice(0, 7)).toBe('2026-09');
      expect(e.starts_at).not.toMatch(/T00:00/); // timeless banners skipped
      expect(e.source_url).toMatch(/^https:\/\/nowyteatr\.org\/pl\/kalendarz\//);
    }
  });

  it('skips the timeless festival banner rows (would fail the midnight guard)', async () => {
    const html = await loadFixture(SEPTEMBER);
    const events = parseNowyTeatrMonth(html, '2026-09');
    // "Generation After 10. Showcase" cells on 03/04 carry no <time>.
    const showcaseDays = events
      .filter((e) => e.source_url.includes('generation-after-10-showcase'))
      .map((e) => e.starts_at.slice(0, 10));
    expect(showcaseDays).not.toContain('2026-09-03');
    expect(showcaseDays).not.toContain('2026-09-04');
  });
});

describe('scrapeNowyTeatr', () => {
  it('fetches one month per GET with the form params and filters to the window', async () => {
    const html = await loadFixture(SEPTEMBER);
    const fetched: string[] = [];
    const fakeFetch = (async (url: string | URL) => {
      fetched.push(String(url));
      return new Response(html, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeNowyTeatr({
      baseUrl: 'https://nowyteatr.org/pl/kalendarz',
      today: new Date('2026-08-20T08:00:00.000Z'),
      windowDays: 30, // ends 19.09 → August + September pages
      fetcher: fakeFetch,
    });

    expect(fetched).toEqual([
      'https://nowyteatr.org/pl/kalendarz?date_from=2026-08-01&date_to=2026-08-31',
      'https://nowyteatr.org/pl/kalendarz?date_from=2026-09-01&date_to=2026-09-30',
    ]);
    // The same September fixture is served for both months; the August pass
    // stamps rows as August, but only days ≤ 19.09 survive the window filter.
    for (const e of res.events) {
      const day = e.starts_at.slice(0, 10);
      expect(day >= '2026-08-20' && day <= '2026-09-19').toBe(true);
    }
    expect(res.events.length).toBeGreaterThan(0);
  });
});

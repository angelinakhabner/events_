import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFilharmoniaListing, inferIsoDay, scrapeFilharmonia } from './filharmonia.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');

const loadFixture = (name: string) => fs.readFile(path.join(fixtureDir, name), 'utf-8');

// The fixtures were captured 2026-07-12; the venue is on summer break until
// 24.08, so "today" anchors year inference and window math to the capture date.
const TODAY = '2026-07-12';

describe('inferIsoDay', () => {
  it('parses D.MM and DD.MM against the current year', () => {
    expect(inferIsoDay('24.08', TODAY)).toBe('2026-08-24');
    expect(inferIsoDay('1.09', TODAY)).toBe('2026-09-01');
  });

  it('rolls a far-past month into the next year (Dec→Jan wrap)', () => {
    expect(inferIsoDay('5.01', '2026-12-20')).toBe('2027-01-05');
  });

  it('keeps a date just behind today in the current year (grace week)', () => {
    expect(inferIsoDay('10.07', TODAY)).toBe('2026-07-10');
  });

  it('rejects garbage', () => {
    expect(inferIsoDay('wtorek', TODAY)).toBeNull();
    expect(inferIsoDay('', TODAY)).toBeNull();
  });
});

describe('parseFilharmoniaListing', () => {
  it('parses every concert card on page 1 with real dates and times', async () => {
    const html = await loadFixture('filharmonia.pl-repertuar.html');
    const events = parseFilharmoniaListing(html, TODAY);

    expect(events.length).toBe(12);
    const first = events[0]!;
    expect(first.title).toContain('Chopin');
    expect(first.starts_at).toMatch(/^2026-08-24T19:00:00\+02:00$/);
    expect(first.source_url).toMatch(/^https:\/\/filharmonia\.pl\/repertuar\//);
    expect(first.source_id).toMatch(/^\d{5,}$/);

    // Every row has a timezone-stamped start and a per-event URL.
    for (const e of events) {
      expect(e.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+\d{2}:00$/);
      expect(e.source_url).not.toBe('https://filharmonia.pl/repertuar/');
    }
    // No midnight placeholders — the validator would drop them for music.
    expect(events.some((e) => e.starts_at.includes('T00:00'))).toBe(false);
  });

  it('parses page 2 (September/October dates roll correctly)', async () => {
    const html = await loadFixture('filharmonia.pl-repertuar-p-2.html');
    const events = parseFilharmoniaListing(html, TODAY);
    expect(events.length).toBe(12);
    expect(events[0]!.starts_at.slice(0, 10)).toBe('2026-09-04');
    expect(events.at(-1)!.starts_at.slice(0, 10)).toBe('2026-10-11');
  });

  it('description carries performers and hall', async () => {
    const html = await loadFixture('filharmonia.pl-repertuar.html');
    const events = parseFilharmoniaListing(html, TODAY);
    expect(events[0]!.description).toContain('Miejsce: Sala Koncertowa');
  });
});

describe('scrapeFilharmonia', () => {
  it('walks pages until past the window and filters to [today, today+window]', async () => {
    const page1 = await loadFixture('filharmonia.pl-repertuar.html');
    const page2 = await loadFixture('filharmonia.pl-repertuar-p-2.html');
    const fetched: string[] = [];
    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      fetched.push(u);
      const body = u.includes('p=2') ? page2 : u.includes('p=') ? '<html></html>' : page1;
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeFilharmonia({
      baseUrl: 'https://filharmonia.pl/repertuar/',
      today: new Date('2026-07-12T08:00:00.000Z'),
      windowDays: 45, // window ends 2026-08-26
      fetcher: fakeFetch,
    });

    // Page 1 spans 24.08–3.09 (crosses the window end), so page 2 is fetched
    // and then the walk stops because page 2 starts beyond the window.
    expect(fetched[0]).toBe('https://filharmonia.pl/repertuar');
    expect(fetched[1]).toBe('https://filharmonia.pl/repertuar?p=2');
    expect(fetched).toHaveLength(2);

    // Only the 24–26.08 concerts fall inside the 45-day window.
    const days = res.events.map((e) => e.starts_at.slice(0, 10));
    expect(days).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
    expect(res.signature).toContain('event-list-row');
  });

  it('summer break: an empty in-window slice yields zero events, not an error', async () => {
    const page1 = await loadFixture('filharmonia.pl-repertuar.html');
    const fakeFetch = (async () =>
      new Response(page1, { status: 200 })) as unknown as typeof fetch;

    const res = await scrapeFilharmonia({
      baseUrl: 'https://filharmonia.pl/repertuar/',
      today: new Date('2026-07-01T08:00:00.000Z'),
      windowDays: 30, // ends 31.07 — the break
      fetcher: fakeFetch,
    });
    expect(res.events).toEqual([]);
  });

  /**
   * A complete walk claims the whole window; a truncated one must not
   * (GOI-107). The runner prunes on the strength of a successful scrape, so a
   * run that lost page two and said nothing would have the days it never read
   * deleted as though it had read them and found nothing there.
   */
  it('claims the whole window when the walk finishes', async () => {
    const page1 = await loadFixture('filharmonia.pl-repertuar.html');
    const fakeFetch = (async () =>
      new Response(page1, { status: 200 })) as unknown as typeof fetch;

    const res = await scrapeFilharmonia({
      baseUrl: 'https://filharmonia.pl/repertuar/',
      today: new Date('2026-07-01T08:00:00.000Z'),
      windowDays: 30,
      fetcher: fakeFetch,
    });
    expect(res.coveredThrough).toBeUndefined();
  });

  it('reports how far it got when a page fails to load', async () => {
    const page1 = await loadFixture('filharmonia.pl-repertuar.html');
    const fakeFetch = (async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('?p=2')) return new Response('nope', { status: 500 });
      return new Response(page1, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeFilharmonia({
      baseUrl: 'https://filharmonia.pl/repertuar/',
      today: new Date('2026-07-12T08:00:00.000Z'),
      windowDays: 45,
      fetcher: fakeFetch,
    });

    // Page one's last concert is as far as this run may be trusted.
    expect(res.coveredThrough).toBe('2026-09-03');
  });
});

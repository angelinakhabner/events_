import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  currentMonth, monthUrl, parseStageTime, parseTeatrStudioMonth, scrapeTeatrStudio,
} from './teatrstudio.js';

// Real render of https://teatrstudio.pl/repertuar (GOI-39).
const FIXTURE = readFileSync(
  join(process.cwd(), 'test/fixtures/teatrstudio.pl-repertuar.html'),
  'utf8',
);

describe('currentMonth', () => {
  it('derives the month from the pager rather than the label', () => {
    // The highlighted label is a Polish month name with no year, so December
    // would be ambiguous; the next link carries MM-YYYY.
    expect(currentMonth(FIXTURE)).toBe('2026-07');
  });

  it('returns null when there is no pager', () => {
    expect(currentMonth('<html><body>nothing</body></html>')).toBeNull();
  });

  it('steps back across a year boundary', () => {
    const html = '<a class="c-datepanel__btn c-datepanel__btn--next" href="?month=01-2027">x</a>';
    expect(currentMonth(html)).toBe('2026-12');
  });

  it('falls back to the prev link when there is no next', () => {
    const html = '<a class="c-datepanel__btn c-datepanel__btn--prev" href="?month=12-2026">x</a>';
    expect(currentMonth(html)).toBe('2027-01');
  });
});

describe('parseStageTime', () => {
  it('reads the time out of the "G. HH:MM" label', () => {
    expect(parseStageTime('G. 15:00 ')).toBe('15:00');
    expect(parseStageTime('  G. 20:15')).toBe('20:15');
  });

  it('returns null for a cell with no time', () => {
    expect(parseStageTime('')).toBeNull();
    expect(parseStageTime('brak')).toBeNull();
  });
});

describe('parseTeatrStudioMonth (real fixture)', () => {
  const rows = parseTeatrStudioMonth(FIXTURE, null, 'Europe/Warsaw');

  it('extracts the month\'s performances', () => {
    expect(rows).toHaveLength(7);
  });

  it('stamps rows with the pager\'s month and the Warsaw offset', () => {
    expect(rows[0]!.starts_at).toBe('2026-07-01T15:00:00+02:00');
    for (const r of rows) expect(r.starts_at.startsWith('2026-07-')).toBe(true);
  });

  it('names the stage each performance is on', () => {
    // Three stages share one row; the column is the only thing distinguishing
    // them, and it is worth keeping for the reader.
    const stages = new Set(rows.map((r) => r.description));
    expect(stages.has('Scena: Duża')).toBe(true);
    expect(stages.has('Scena: Galeria studio')).toBe(true);
  });

  it('keeps each date of a run as its own row', () => {
    // The gallery show runs five consecutive days; collapsing them onto one
    // slug would lose four of them.
    const run = rows.filter((r) => r.title.startsWith('FILIPKA RUTKOWSKA'));
    expect(run.length).toBe(5);
    expect(new Set(run.map((r) => r.source_id)).size).toBe(5);
  });

  it('never emits a duplicate id', () => {
    const ids = rows.map((r) => r.source_id);
    expect(new Set(ids).size).toBe(rows.length);
  });

  it('resolves links absolutely', () => {
    for (const r of rows) expect(r.source_url).toMatch(/^https:\/\/teatrstudio\.pl\//);
  });

  it('returns nothing when the month cannot be determined', () => {
    expect(parseTeatrStudioMonth('<html></html>', null, 'Europe/Warsaw')).toEqual([]);
  });

  it('honours an explicitly supplied month over the page\'s pager', () => {
    // The scraper passes the month it *asked* for, so a redirect back to the
    // current month can't stamp rows with the wrong one.
    const forced = parseTeatrStudioMonth(FIXTURE, '2026-09', 'Europe/Warsaw');
    expect(forced.length).toBeGreaterThan(0);
    for (const r of forced) expect(r.starts_at.startsWith('2026-09-')).toBe(true);
  });
});

describe('monthUrl', () => {
  it('builds the pager\'s own shape and drops an existing query', () => {
    expect(monthUrl('https://teatrstudio.pl/repertuar', 2026, 8))
      .toBe('https://teatrstudio.pl/repertuar?month=08-2026');
    expect(monthUrl('https://teatrstudio.pl/repertuar?month=01-2020', 2026, 12))
      .toBe('https://teatrstudio.pl/repertuar?month=12-2026');
  });
});

describe('scrapeTeatrStudio', () => {
  it('walks months and bounds rows to the window', async () => {
    const seen: string[] = [];
    const fetcher = (async (url: string | URL) => {
      seen.push(url.toString());
      return new Response(FIXTURE, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;

    const res = await scrapeTeatrStudio({
      baseUrl: 'https://teatrstudio.pl/repertuar',
      today: new Date('2026-07-01T08:00:00Z'),
      windowDays: 40,
      timezone: 'Europe/Warsaw',
      fetcher,
    });

    // July + August, since the window reaches into August but not September.
    expect(seen).toEqual([
      'https://teatrstudio.pl/repertuar?month=07-2026',
      'https://teatrstudio.pl/repertuar?month=08-2026',
    ]);
    for (const e of res.events) {
      expect(e.starts_at.slice(0, 10) >= '2026-07-01').toBe(true);
      expect(e.starts_at.slice(0, 10) <= '2026-08-10').toBe(true);
    }
  });

  it('drops days already past', async () => {
    const fetcher = (async () =>
      new Response(FIXTURE, { status: 200, headers: { 'content-type': 'text/html' } })
    ) as unknown as typeof fetch;
    const res = await scrapeTeatrStudio({
      baseUrl: 'https://teatrstudio.pl/repertuar',
      today: new Date('2026-07-06T08:00:00Z'),
      windowDays: 30,
      timezone: 'Europe/Warsaw',
      fetcher,
    });
    // The five-day gallery run ended on the 5th, so none of it survives.
    expect(res.events.every((e) => e.starts_at >= '2026-07-06')).toBe(true);
  });

  /**
   * A complete walk claims the whole window; a truncated one must not
   * (GOI-107). The runner prunes on the strength of a successful scrape, so a
   * run that lost August and said nothing would have August deleted as though
   * it had read it and found nothing on.
   */
  it('claims the whole window when every month loads', async () => {
    const fetcher = (async () =>
      new Response(FIXTURE, { status: 200, headers: { 'content-type': 'text/html' } })
    ) as unknown as typeof fetch;
    const res = await scrapeTeatrStudio({
      baseUrl: 'https://teatrstudio.pl/repertuar',
      today: new Date('2026-07-01T08:00:00Z'),
      windowDays: 40,
      timezone: 'Europe/Warsaw',
      fetcher,
    });
    expect(res.coveredThrough).toBeUndefined();
  });

  it('reports the last month it read when a later one fails', async () => {
    const fetcher = (async (url: string | URL) => {
      if (url.toString().includes('month=08-2026')) return new Response('nope', { status: 500 });
      return new Response(FIXTURE, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;

    const res = await scrapeTeatrStudio({
      baseUrl: 'https://teatrstudio.pl/repertuar',
      today: new Date('2026-07-01T08:00:00Z'),
      windowDays: 40,
      timezone: 'Europe/Warsaw',
      fetcher,
    });

    expect(res.coveredThrough).toBe('2026-07-31');
  });

  it('reports nothing beyond today when the first month fails', async () => {
    const fetcher = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const res = await scrapeTeatrStudio({
      baseUrl: 'https://teatrstudio.pl/repertuar',
      today: new Date('2026-07-01T08:00:00Z'),
      windowDays: 40,
      timezone: 'Europe/Warsaw',
      fetcher,
    });
    expect(res.coveredThrough).toBe('2026-07-01');
  });
});

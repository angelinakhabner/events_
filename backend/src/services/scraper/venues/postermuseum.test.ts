import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseExhibitionRun,
  parseExhibitionsListing,
  expandRun,
  parsePosterMuseum,
  scrapePosterMuseum,
  type ExhibitionRun,
} from './postermuseum.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');
const loadFixture = (name: string) => fs.readFile(path.join(fixtureDir, name), 'utf-8');

const OBECNE = 'https://www.postermuseum.pl/wystawy/obecne.html';
const TODAY = '2026-08-07';

// The exhibition page states its run in prose, in Polish, and the year is
// wherever the writer felt like putting it. Every shape below is one the live
// page has actually produced.
describe('parseExhibitionRun', () => {
  it('takes the year from the right when only the end carries one', () => {
    expect(parseExhibitionRun('20 czerwca - 13 września 2026', TODAY)).toEqual({
      start: '2026-06-20',
      end: '2026-09-13',
    });
  });

  it('keeps both years when the run crosses New Year', () => {
    expect(parseExhibitionRun('29 września 2026 - 10 stycznia 2027', TODAY)).toEqual({
      start: '2026-09-29',
      end: '2027-01-10',
    });
  });

  // Borrowing the end's year would put the start *after* the end; the only
  // reading that works is the previous year.
  it('walks the start back a year when the borrowed year overshoots', () => {
    expect(parseExhibitionRun('20 grudnia - 10 stycznia 2027', TODAY)).toEqual({
      start: '2026-12-20',
      end: '2027-01-10',
    });
  });

  it('borrows the month too when the run stays inside one', () => {
    expect(parseExhibitionRun('1 - 13 września 2026', TODAY)).toEqual({
      start: '2026-09-01',
      end: '2026-09-13',
    });
  });

  it('reads en dashes, em dashes and "od … do …" alike', () => {
    const expected = { start: '2026-06-20', end: '2026-09-13' };
    expect(parseExhibitionRun('20 czerwca – 13 września 2026', TODAY)).toEqual(expected);
    expect(parseExhibitionRun('20 czerwca — 13 września 2026', TODAY)).toEqual(expected);
    expect(parseExhibitionRun('od 20 czerwca do 13 września 2026', TODAY)).toEqual(expected);
  });

  it('treats a single date as a one-day run', () => {
    expect(parseExhibitionRun('13 września 2026', TODAY)).toEqual({
      start: '2026-09-13',
      end: '2026-09-13',
    });
  });

  // A page still advertising January in December means *next* January.
  it('reads an undated run as the next one still ahead', () => {
    expect(parseExhibitionRun('5 - 20 stycznia', '2026-12-15')).toEqual({
      start: '2027-01-05',
      end: '2027-01-20',
    });
    expect(parseExhibitionRun('5 - 20 grudnia', '2026-12-01')).toEqual({
      start: '2026-12-05',
      end: '2026-12-20',
    });
  });

  it('refuses prose it cannot date rather than guessing', () => {
    expect(parseExhibitionRun('wystawa stała', TODAY)).toBeNull();
    expect(parseExhibitionRun('', TODAY)).toBeNull();
    expect(parseExhibitionRun('20 smerfnia - 13 września 2026', TODAY)).toBeNull();
    expect(parseExhibitionRun('31 lutego 2026', TODAY)).toBeNull();
    // Backwards is not a run.
    expect(parseExhibitionRun('13 września 2026 - 20 czerwca 2026', TODAY)).toBeNull();
  });
});

describe('parseExhibitionsListing', () => {
  it('reads the running exhibition off the live page', async () => {
    const runs = parseExhibitionsListing(await loadFixture('www.postermuseum.pl-wystawy-obecne.html'), OBECNE, TODAY);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      title: 'Plakat polski. Kolekcja / odsłona 2.',
      start: '2026-06-20',
      end: '2026-09-13',
      sourceUrl: 'https://www.postermuseum.pl/wystawy/plakat-polski-kolekcja-odslona-2-,89.html',
      sourceId: '89',
    });
  });

  it('reads the planned one, which starts after the current one ends', async () => {
    const runs = parseExhibitionsListing(
      await loadFixture('www.postermuseum.pl-wystawy-planowane.html'),
      'https://www.postermuseum.pl/wystawy/planowane.html',
      TODAY,
    );

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      title: 'Plakat polski. Kolekcja / odsłona 3.',
      start: '2026-09-29',
      end: '2027-01-10',
      sourceId: '90',
    });
  });
});

describe('expandRun', () => {
  const run: ExhibitionRun = {
    title: 'Plakat polski',
    start: '2026-06-20',
    end: '2026-09-13',
    description: null,
    sourceUrl: 'https://www.postermuseum.pl/wystawy/x,89.html',
    sourceId: '89',
  };

  // The clip is what keeps a three-month run from becoming three months of
  // rows, and what makes an exhibition that opened in June appear under today.
  it('emits one all-day row per day inside the window', () => {
    const rows = expandRun(run, '2026-08-07', '2026-08-09');

    expect(rows.map((r) => r.starts_at)).toEqual([
      '2026-08-07T00:00:00+02:00',
      '2026-08-08T00:00:00+02:00',
      '2026-08-09T00:00:00+02:00',
    ]);
    expect(rows.map((r) => r.source_id)).toEqual([
      'postermuseum:wystawa:89:2026-08-07',
      'postermuseum:wystawa:89:2026-08-08',
      'postermuseum:wystawa:89:2026-08-09',
    ]);
  });

  it('clips to the run itself, not just the window', () => {
    expect(expandRun(run, '2026-06-18', '2026-06-21').map((r) => r.starts_at.slice(0, 10))).toEqual([
      '2026-06-20',
      '2026-06-21',
    ]);
    expect(expandRun(run, '2026-09-12', '2026-09-20').map((r) => r.starts_at.slice(0, 10))).toEqual([
      '2026-09-12',
      '2026-09-13',
    ]);
  });

  it('emits nothing for a run entirely outside the window', () => {
    expect(expandRun(run, '2026-10-01', '2026-11-30')).toEqual([]);
  });

  // Stepping the calendar day rather than adding 24h: Warsaw falls back on
  // 25 October 2026, and an hours-based step would repeat the 25th.
  it('steps calendar days across a fall-back night', () => {
    const dst: ExhibitionRun = { ...run, start: '2026-10-24', end: '2026-10-27' };
    expect(expandRun(dst, '2026-10-24', '2026-10-27').map((r) => r.starts_at)).toEqual([
      '2026-10-24T00:00:00+02:00',
      '2026-10-25T00:00:00+02:00',
      '2026-10-26T00:00:00+01:00',
      '2026-10-27T00:00:00+01:00',
    ]);
  });
});

// The venue has two page shapes and htmlOverride passes whichever was fetched.
describe('parsePosterMuseum', () => {
  it('reads the calendar page as timed events', async () => {
    const rows = parsePosterMuseum(
      await loadFixture('www.postermuseum.pl-wydarzenia.html'),
      'Europe/Warsaw',
      new Date('2026-08-07T09:00:00Z'),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'OPROWADZANIA KURATORSKIE / Plakat polski. Kolekcja',
      starts_at: '2026-08-23T11:00:00+02:00',
      source_url:
        'https://www.postermuseum.pl/wydarzenia/kalendarz-wydarzen/1809,wydarzenie.html',
    });
  });

  it('reads the exhibitions page as all-day runs', async () => {
    const rows = parsePosterMuseum(
      await loadFixture('www.postermuseum.pl-wystawy-obecne.html'),
      'Europe/Warsaw',
      new Date('2026-08-07T09:00:00Z'),
    );

    // 7 August → 13 September inclusive, all at local midnight.
    expect(rows).toHaveLength(38);
    expect(rows.every((r) => r.starts_at.includes('T00:00:00'))).toBe(true);
    expect(rows[0]!.starts_at.slice(0, 10)).toBe('2026-08-07');
    expect(rows.at(-1)!.starts_at.slice(0, 10)).toBe('2026-09-13');
  });
});

describe('scrapePosterMuseum', () => {
  /** Serve the captured pages; anything else 404s. */
  async function fixtureFetcher(): Promise<typeof fetch> {
    const pages: Record<string, string> = {
      'https://www.postermuseum.pl/wydarzenia/kalendarz-wydarzen/08-2026,lista,miesiac.html':
        await loadFixture('www.postermuseum.pl-wydarzenia.html'),
      'https://www.postermuseum.pl/wydarzenia/kalendarz-wydarzen/09-2026,lista,miesiac.html':
        await loadFixture('www.postermuseum.pl-kalendarz-09-2026.html'),
      'https://www.postermuseum.pl/wystawy/obecne.html':
        await loadFixture('www.postermuseum.pl-wystawy-obecne.html'),
      'https://www.postermuseum.pl/wystawy/planowane.html':
        await loadFixture('www.postermuseum.pl-wystawy-planowane.html'),
    };
    return (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = pages[url];
      return body === undefined
        ? new Response('not found', { status: 404 })
        : new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
  }

  const args = async () => ({
    baseUrl: 'https://www.postermuseum.pl/wydarzenia/kalendarz-wydarzen/08-2026,lista,miesiac.html',
    today: new Date('2026-08-07T09:00:00Z'),
    windowDays: 60,
    timezone: 'Europe/Warsaw',
    fetcher: await fixtureFetcher(),
  });

  it('returns the calendar events and the exhibition runs together', async () => {
    const { events } = await scrapePosterMuseum(await args());

    const timed = events.filter((e) => !e.starts_at.includes('T00:00:00'));
    const allDay = events.filter((e) => e.starts_at.includes('T00:00:00'));

    // Both curator tours, from August's page and September's.
    expect(timed.map((e) => e.starts_at)).toEqual([
      '2026-08-23T11:00:00+02:00',
      '2026-09-13T11:00:00+02:00',
    ]);
    // The running exhibition through 13 September, then the planned one from
    // 29 September to the window's edge.
    expect(new Set(allDay.map((e) => e.title))).toEqual(
      new Set(['Plakat polski. Kolekcja / odsłona 2.', 'Plakat polski. Kolekcja / odsłona 3.']),
    );
    expect(allDay.some((e) => e.starts_at.startsWith('2026-08-07'))).toBe(true);
    // 60 days from 7 August is 6 October — nothing beyond it.
    expect(allDay.every((e) => e.starts_at.slice(0, 10) <= '2026-10-06')).toBe(true);
  });

  // Losing the exhibitions is bad; losing the whole museum because one extra
  // page 500'd is worse.
  it('still returns the calendar when an exhibition page fails', async () => {
    const only = (await fixtureFetcher()) as typeof fetch;
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/wystawy/')) throw new Error('boom');
      return only(input);
    }) as typeof fetch;

    const { events } = await scrapePosterMuseum({ ...(await args()), fetcher });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => !e.starts_at.includes('T00:00:00'))).toBe(true);
  });

  it('changes its signature when a page changes, so unchanged runs skip', async () => {
    const a = await scrapePosterMuseum(await args());
    const b = await scrapePosterMuseum(await args());
    expect(a.signature).toBe(b.signature);
    expect(a.signature).toContain('/wystawy/obecne.html');
  });
});

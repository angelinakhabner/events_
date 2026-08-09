import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseExhibitionRun,
  parseExhibitionsListing,
  expandRun,
  type ExhibitionRun,
} from './edito-exhibitions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');
const loadFixture = (name: string) => fs.readFile(path.join(fixtureDir, name), 'utf-8');

const OBECNE = 'https://www.postermuseum.pl/wystawy/obecne.html';
const TODAY = '2026-08-07';

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


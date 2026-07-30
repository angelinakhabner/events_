import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  inferIsoDay, parseCardTime, parseDayHeading, parseMsnProgram, scrapeMsn,
} from './msn.js';

// Real capture of https://artmuseum.pl/en/program-1 (GOI-31).
const FIXTURE = readFileSync(
  join(process.cwd(), 'test/fixtures/artmuseum.pl-en-program-1.html'),
  'utf8',
);
const TODAY = '2026-07-29';

describe('parseDayHeading', () => {
  it('reads the weekday, day and month', () => {
    expect(parseDayHeading('Wednesday, 29 July')).toEqual({ weekday: 3, day: 29, month: 7 });
    expect(parseDayHeading('Saturday, 01 August')).toEqual({ weekday: 6, day: 1, month: 8 });
  });

  it('tolerates the markup\'s collapsed whitespace', () => {
    // The heading is split by a <br>, so the extracted text has odd spacing.
    expect(parseDayHeading('  Wednesday,   29   July ')).toEqual({ weekday: 3, day: 29, month: 7 });
  });

  it('rejects section headings, which must not carry a day forward', () => {
    // "Current exhibitions" heads the undated block; letting its cards inherit
    // the previous day would invent events.
    expect(parseDayHeading('Current exhibitions')).toBeNull();
    expect(parseDayHeading('Wednesday, 29 Julyish')).toBeNull();
    expect(parseDayHeading('')).toBeNull();
  });
});

describe('parseCardTime', () => {
  it('reads a plain start time', () => {
    expect(parseCardTime('18:00')).toBe('18:00');
  });

  it('takes the start of an opening-hours span', () => {
    expect(parseCardTime('11:00 - 20:00')).toBe('11:00');
    expect(parseCardTime('16:00 – 17:00')).toBe('16:00');
  });

  it('rejects an exhibition run', () => {
    // 44 of the 67 cards are these; treating one as a time would put a
    // five-month exhibition in the listing at an invented hour.
    expect(parseCardTime('20.03.2026–30.08.2026')).toBeNull();
    expect(parseCardTime('26.06.2026–10.01.2027')).toBeNull();
  });

  it('rejects empty and non-time cells', () => {
    expect(parseCardTime('')).toBeNull();
    expect(parseCardTime('Exhibition')).toBeNull();
  });
});

describe('inferIsoDay', () => {
  it('keeps the current year for a date ahead of today', () => {
    expect(inferIsoDay(29, 7, 3, TODAY)).toBe('2026-07-29');
  });

  it('lets the weekday correct a rolled-forward guess', () => {
    // 15.01.2027 is a Friday, 15.01.2026 a Thursday.
    expect(inferIsoDay(15, 1, 5, TODAY)).toBe('2027-01-15');
    expect(inferIsoDay(15, 1, 4, TODAY)).toBe('2026-01-15');
  });

  it('returns null for a date that does not exist', () => {
    expect(inferIsoDay(31, 2, null, TODAY)).toBeNull();
  });
});

describe('parseMsnProgram (real fixture)', () => {
  const rows = parseMsnProgram(FIXTURE, TODAY, 'Europe/Warsaw');

  it('extracts the timed events and nothing else', () => {
    // 67 cards on the page; the rest are standing exhibitions with date ranges.
    expect(rows).toHaveLength(21);
  });

  it('stamps every row with a real Warsaw instant', () => {
    for (const r of rows) {
      expect(r.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+02:00$/);
    }
  });

  it('associates each card with the day heading above it', () => {
    // The headings and cards are siblings, so this is the whole risk of the
    // parser: a card must not inherit the wrong day.
    expect(rows[0]).toMatchObject({ title: 'Following', starts_at: '2026-07-29T17:30:00+02:00' });
    const last = rows[rows.length - 1]!;
    expect(last.starts_at.slice(0, 10)).toBe('2026-08-04');
  });

  it('returns rows in ascending order', () => {
    const starts = rows.map((r) => r.starts_at);
    expect([...starts].sort()).toEqual(starts);
  });

  it('does not read a lone time cell as a category', () => {
    // Most cards have only the time; using it as the label would file every
    // event under its own start hour.
    for (const r of rows) {
      // Null is the correct answer for a card with no label at all.
      expect(r.description ?? '').not.toMatch(/^\d{1,2}:\d{2}/);
    }
    // The cards that *do* carry a label keep it.
    expect(rows.some((r) => r.description === 'Szumin')).toBe(true);
  });

  it('gives each occurrence a distinct id, including a repeated title', () => {
    // "The Souffleur" and "Ghost in the Shell" each run on two days.
    const ids = rows.map((r) => r.source_id);
    expect(new Set(ids).size).toBe(rows.length);
    expect(rows.filter((r) => r.title === 'The Souffleur').length).toBeGreaterThan(1);
  });

  it('resolves links against the site origin', () => {
    for (const r of rows) expect(r.source_url).toMatch(/^https:\/\/artmuseum\.pl\//);
  });
});

describe('scrapeMsn', () => {
  const fetcherFor = (html: string) => {
    const seen: string[] = [];
    const fetcher = (async (url: string | URL) => {
      seen.push(url.toString());
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    return { fetcher, seen };
  };

  it('fetches once and bounds rows to the window', async () => {
    const { fetcher, seen } = fetcherFor(FIXTURE);
    const res = await scrapeMsn({
      baseUrl: 'https://artmuseum.pl/en/program-1',
      today: new Date('2026-07-29T08:00:00Z'),
      windowDays: 3,
      timezone: 'Europe/Warsaw',
      fetcher,
    });
    expect(seen).toHaveLength(1);
    expect(res.events.length).toBeGreaterThan(0);
    for (const e of res.events) {
      expect(e.starts_at.slice(0, 10) <= '2026-08-01').toBe(true);
    }
  });

  it('normalises the old query-string URL, which now 404s', async () => {
    // Databases seeded before the site rebuild still hold ?from=…&type=all.
    const { fetcher, seen } = fetcherFor(FIXTURE);
    await scrapeMsn({
      baseUrl: 'https://artmuseum.pl/en/program-1?from=2026-07-29&type=all',
      today: new Date('2026-07-29T08:00:00Z'),
      windowDays: 30,
      fetcher,
    });
    expect(seen[0]).toBe('https://artmuseum.pl/en/program-1');
  });
});

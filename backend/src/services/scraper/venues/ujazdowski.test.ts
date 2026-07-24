import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUjazdowskiDay, utForDay, scrapeUjazdowski } from './ujazdowski.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');

const loadFixture = (name: string) => fs.readFile(path.join(fixtureDir, name), 'utf-8');

const ORIGIN = 'https://u-jazdowski.pl';

describe('utForDay', () => {
  it('matches the site’s own ut keys (midnight Warsaw, CEST)', () => {
    // The captured fragment for 2026-07-06 was served at ut=1783288800.
    expect(utForDay('2026-07-06')).toBe(1783288800);
  });
  it('handles winter (CET) days', () => {
    // 2026-01-15T00:00+01:00 → 2026-01-14T23:00:00Z
    expect(utForDay('2026-01-15')).toBe(Math.floor(new Date('2026-01-14T23:00:00Z').getTime() / 1000));
  });
});

describe('parseUjazdowskiDay', () => {
  it('parses the day fragment: title, time, per-event URL', async () => {
    const html = await loadFixture('u-jazdowski.pl-en-wydarzenia-week.ajax-ut-1783288800.html');
    const events = parseUjazdowskiDay(html, '2026-07-06', ORIGIN);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const film = events.find((e) => e.source_url.includes('the-piano-accident'))!;
    expect(film).toBeDefined();
    expect(film.title).toBe('The Piano Accident');
    expect(film.starts_at).toBe('2026-07-06T20:30:00+02:00'); // "20<i>:</i>30" normalised
    expect(film.description).toBe('film');
  });

  it('parses a different week’s fragment', async () => {
    const html = await loadFixture('u-jazdowski.pl-en-wydarzenia-week.ajax-ut-1783893600.html');
    const events = parseUjazdowskiDay(html, '2026-07-13', ORIGIN);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.starts_at).toBe('2026-07-13T18:00:00+02:00');
  });
});

describe('scrapeUjazdowski', () => {
  it('fetches one fragment per day in the window and stamps rows with that day', async () => {
    const fragment = await loadFixture('u-jazdowski.pl-en-wydarzenia-week.ajax-ut-1783288800.html');
    const fetched: string[] = [];
    const fakeFetch = (async (url: string | URL) => {
      fetched.push(String(url));
      return new Response(fragment, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeUjazdowski({
      baseUrl: 'https://u-jazdowski.pl/en/wydarzenia',
      today: new Date('2026-07-06T08:00:00.000Z'),
      windowDays: 2,
      fetcher: fakeFetch,
    });

    expect(fetched).toEqual([
      `https://u-jazdowski.pl/en/wydarzenia/week.ajax?ut=${utForDay('2026-07-06')}`,
      `https://u-jazdowski.pl/en/wydarzenia/week.ajax?ut=${utForDay('2026-07-07')}`,
      `https://u-jazdowski.pl/en/wydarzenia/week.ajax?ut=${utForDay('2026-07-08')}`,
    ]);
    // The same fixture served for 3 days yields one row per day (distinct starts).
    expect(res.events.map((e) => e.starts_at.slice(0, 10))).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
    ]);
  });
});

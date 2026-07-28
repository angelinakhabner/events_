import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJassmineListing, inferIsoDay, scrapeJassmine } from './jassmine.js';
import { validateEvents } from '../validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');
const TZ = 'Europe/Warsaw';
const BASE_URL = 'https://jassmine.com/koncerty/';
// The fixture was captured on 2026-07-28; its listing runs 30 Jul → 20 Dec 2026.
const TODAY = '2026-07-28';

let html = '';
beforeAll(async () => {
  html = await fs.readFile(path.join(fixtureDir, 'jassmine-koncerty.html'), 'utf-8');
});

describe('inferIsoDay', () => {
  it('keeps a date later this year', () => {
    expect(inferIsoDay('20/12', TODAY, 'Niedziela')).toBe('2026-12-20');
  });

  it('rolls into next year for the Dec→Jan wrap', () => {
    expect(inferIsoDay('03/01', '2026-12-28', 'Niedziela')).toBe('2027-01-03');
  });

  it('uses the weekday to correct a stale year the roll-forward rule gets wrong', () => {
    // Anchored a year late (the admin htmlOverride path anchors to "now", so a
    // re-pasted listing lands here). Roll-forward alone would say 2027-07-30,
    // which is a Friday — the tile says Thursday, so 2026 is the real year.
    expect(inferIsoDay('30/07', '2027-07-28', 'Czwartek')).toBe('2026-07-30');
    expect(inferIsoDay('30/07', '2027-07-28', null)).toBe('2027-07-30');
  });

  it('keeps the roll-forward date when the weekday matches no nearby year', () => {
    expect(inferIsoDay('30/07', TODAY, 'Poniedziałek')).toBe('2026-07-30');
  });

  it('rejects impossible and malformed dates', () => {
    expect(inferIsoDay('31/02', TODAY, null)).toBeNull();
    expect(inferIsoDay('sobota', TODAY, null)).toBeNull();
    expect(inferIsoDay('', TODAY, null)).toBeNull();
  });
});

describe('parseJassmineListing', () => {
  it('extracts every concert on the page', () => {
    expect(parseJassmineListing(html, TODAY, TZ)).toHaveLength(64);
  });

  it('reads title, concert page and showtime off each tile', () => {
    const [first] = parseJassmineListing(html, TODAY, TZ);
    expect(first).toMatchObject({
      title: 'Kinga Głyk',
      starts_at: '2026-07-30T19:00:00+02:00',
      source_url: 'https://jassmine.com/concert/kinga-glyk/',
    });
  });

  it('stamps the real Warsaw offset either side of the DST switch', () => {
    const events = parseJassmineListing(html, TODAY, TZ);
    const summer = events.find((e) => e.starts_at.startsWith('2026-07-30'))!;
    const winter = events.find((e) => e.starts_at.startsWith('2026-12-20'))!;
    expect(summer.starts_at).toBe('2026-07-30T19:00:00+02:00'); // CEST
    expect(winter.starts_at).toBe('2026-12-20T19:00:00+01:00'); // CET
  });

  it('is not fooled by the "Sold out" badge sharing the date block', () => {
    // Mieczysław Szcześniak's tile carries <span>31/07</span>, the hour, and a
    // "Sold out" span — the date must still come from the DD/MM one.
    const soldOut = parseJassmineListing(html, TODAY, TZ).find((e) =>
      e.source_url.includes('mieczyslaw-szczesniak'),
    )!;
    expect(soldOut.starts_at).toBe('2026-07-31T19:00:00+02:00');
  });

  it('returns events in ascending date order with no duplicates', () => {
    const days = parseJassmineListing(html, TODAY, TZ).map((e) => e.starts_at);
    expect(days).toEqual([...days].sort());
    expect(new Set(days.map((d, i) => `${d}|${i}`)).size).toBe(days.length);
  });

  it('leaves description null so the runner enriches from each concert page', () => {
    const events = parseJassmineListing(html, TODAY, TZ);
    expect(events.every((e) => e.description === null)).toBe(true);
    expect(events.every((e) => e.source_url.startsWith('https://jassmine.com/concert/'))).toBe(true);
  });

  it('produces rows that all pass the music validator', () => {
    const { valid, invalid } = validateEvents(parseJassmineListing(html, TODAY, TZ), {
      category: 'music',
      timezone: TZ,
    });
    expect(invalid).toHaveLength(0);
    expect(valid).toHaveLength(64);
  });

  it('absolutizes a relative concert link', () => {
    const tile = `
      <article class="tile-concert">
        <a class="tile-concert__inner" href="/concert/relative-link/">
          <figure class="tile-concert__logo-figure"><h2>Relative</h2></figure>
          <div class="tile-concert__date">
            <span>05/09</span><span class="tile-concert__hour">20:00</span>
          </div>
          <div class="tile-concert__day"><span>Sobota</span></div>
        </a>
      </article>`;
    expect(parseJassmineListing(tile, TODAY, TZ)[0]!.source_url).toBe(
      'https://jassmine.com/concert/relative-link/',
    );
  });

  it('skips tiles missing a title, link, date or hour', () => {
    const broken = `
      <article class="tile-concert">
        <a class="tile-concert__inner" href="/concert/no-title/">
          <div class="tile-concert__date"><span>05/09</span><span class="tile-concert__hour">20:00</span></div>
        </a>
      </article>
      <article class="tile-concert">
        <a class="tile-concert__inner" href="/concert/no-hour/">
          <figure class="tile-concert__logo-figure"><h2>Bez godziny</h2></figure>
          <div class="tile-concert__date"><span>06/09</span></div>
        </a>
      </article>
      <article class="tile-concert">
        <figure class="tile-concert__logo-figure"><h2>Bez linku</h2></figure>
        <div class="tile-concert__date"><span>07/09</span><span class="tile-concert__hour">20:00</span></div>
      </article>`;
    expect(parseJassmineListing(broken, TODAY, TZ)).toEqual([]);
  });
});

describe('scrapeJassmine', () => {
  it('fetches once and keeps only concerts inside the window', async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return new Response(html, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeJassmine({
      baseUrl: BASE_URL,
      today: new Date('2026-07-28T08:00:00Z'),
      windowDays: 45, // the music category window
      timezone: TZ,
      fetcher,
    });

    // The whole programme ships in one response — no pagination to walk.
    expect(calls).toBe(1);
    expect(res.events.length).toBeGreaterThan(0);
    expect(res.events.length).toBeLessThan(64); // Sep–Dec is beyond 45 days
    const days = res.events.map((e) => e.starts_at.slice(0, 10));
    expect(days.every((d) => d >= '2026-07-28' && d <= '2026-09-11')).toBe(true);
    expect(res.signature).toBe(html);
  });

  it('widening the window pulls in the rest of the programme', async () => {
    const fetcher = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
    const res = await scrapeJassmine({
      baseUrl: BASE_URL,
      today: new Date('2026-07-28T08:00:00Z'),
      windowDays: 365,
      timezone: TZ,
      fetcher,
    });
    expect(res.events).toHaveLength(64);
  });

  it('propagates a failed listing fetch to the runner', async () => {
    const fetcher = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(
      scrapeJassmine({
        baseUrl: BASE_URL,
        today: new Date('2026-07-28T08:00:00Z'),
        windowDays: 45,
        timezone: TZ,
        fetcher,
      }),
    ).rejects.toThrow(/503/);
  });
});

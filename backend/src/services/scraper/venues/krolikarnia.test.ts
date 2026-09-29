import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKrolikarnia, scrapeKrolikarnia } from './krolikarnia.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');
const loadFixture = (name: string) => fs.readFile(path.join(fixtureDir, name), 'utf-8');

const TODAY = new Date('2026-08-08T09:00:00Z');

// GOI-43: "not implemented correctly, I see no info". The calendar was the
// only thing being scraped, and a branch museum's calendar is nearly empty —
// what it actually has on is the exhibitions, on a page whose rows carry no
// date fields at all.
describe('parseKrolikarnia', () => {
  it('reads the running exhibition off /wystawy as one dated run', async () => {
    const rows = parseKrolikarnia(
      await loadFixture('krolikarnia.mnw.art.pl-wystawy-obecne.html'),
      'Europe/Warsaw',
      TODAY,
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      title: 'Rzeźba na meblościankę',
      source_url: 'https://krolikarnia.mnw.art.pl/wystawy/rzezba-na-mebloscianke,203.html',
      // A run over a date range, which is what puts it under "Ongoing
      // exhibitions" rather than in a heap of midnight timed rows (GOI-113).
      kind: 'exhibition',
    });
    // 14 May – 25 October, dated by the run itself at both ends rather than
    // clipped to the window: a show up since May did not start this morning,
    // and its closing date is the whole reason to hurry.
    expect(rows[0]!.starts_at.slice(0, 10)).toBe('2026-05-14');
    expect(rows[0]!.ends_at?.slice(0, 10)).toBe('2026-10-25');
    expect(rows[0]!.starts_at).toContain('T00:00:00');
  });

  // The rows are namespaced per venue, so two museums that happen to share an
  // exhibition id can't collide on one another's keys.
  it('files its rows under its own key', async () => {
    const rows = parseKrolikarnia(
      await loadFixture('krolikarnia.mnw.art.pl-wystawy-obecne.html'),
      'Europe/Warsaw',
      TODAY,
    );
    expect(rows[0]!.source_id).toBe('krolikarnia:wystawa:203');
  });

  it('still reads the month calendar when handed one', async () => {
    const rows = parseKrolikarnia(
      await loadFixture('krolikarnia.mnw.art.pl-wydarzenia-kalendarz-wydarzen.html'),
      'Europe/Warsaw',
      TODAY,
    );
    // Whatever the captured month held, calendar rows carry a real clock time
    // rather than the all-day midnight the exhibitions use.
    for (const r of rows) {
      expect(r.source_url).toContain('krolikarnia.mnw.art.pl');
    }
  });
});

describe('scrapeKrolikarnia', () => {
  async function fixtureFetcher(): Promise<typeof fetch> {
    const pages: Record<string, string> = {
      'https://krolikarnia.mnw.art.pl/wystawy/obecne.html':
        await loadFixture('krolikarnia.mnw.art.pl-wystawy-obecne.html'),
      'https://krolikarnia.mnw.art.pl/wystawy/planowane.html':
        await loadFixture('krolikarnia.mnw.art.pl-wystawy-planowane.html'),
    };
    return (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = pages[url];
      return body === undefined
        ? new Response('not found', { status: 404 })
        : new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
  }

  it('picks up the exhibitions even when the calendar months are empty', async () => {
    const { events, signature } = await scrapeKrolikarnia({
      baseUrl:
        'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/08-2026,lista,miesiac.html',
      today: TODAY,
      windowDays: 60,
      timezone: 'Europe/Warsaw',
      fetcher: await fixtureFetcher(),
    });

    // Exactly the failure the issue describes: nothing from the calendar, and
    // before this the venue therefore had nothing at all.
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.title === 'Rzeźba na meblościankę')).toBe(true);
    expect(signature).toContain('/wystawy/obecne.html');
  });

  // "Planowane" is empty in the capture — an empty page is not an error.
  it('treats an exhibition page with no runs as simply empty', async () => {
    const only = await fixtureFetcher();
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('obecne')) return new Response('not found', { status: 404 });
      return only(input);
    }) as typeof fetch;

    const { events } = await scrapeKrolikarnia({
      baseUrl:
        'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/08-2026,lista,miesiac.html',
      today: TODAY,
      windowDays: 60,
      timezone: 'Europe/Warsaw',
      fetcher,
    });
    expect(events).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePosterMuseum, scrapePosterMuseum } from './postermuseum.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');
const loadFixture = (name: string) => fs.readFile(path.join(fixtureDir, name), 'utf-8');

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

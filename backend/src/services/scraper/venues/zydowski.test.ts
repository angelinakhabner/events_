import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseZydowskiRepertoire, scrapeZydowski } from './zydowski.js';
import { getDeterministicScraper } from '../deterministic.js';
import { validateEvents } from '../validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');
const loadFixture = (name: string) => fs.readFile(path.join(fixtureDir, name), 'utf-8');

/** GOI-150: Teatr Żydowski stopped scraping while its page was fine. */
describe('parseZydowskiRepertoire', () => {
  it('reads every performance of the month, with its exact start, stage and show page', async () => {
    const rows = parseZydowskiRepertoire(await loadFixture('www.teatr-zydowski.art.pl-repertuar.html'));
    expect(rows).toHaveLength(14);
    expect(rows[0]).toMatchObject({
      title: 'Niewidzialne baśnie. Na podstawie "Opowiadań dla dzieci" Icchoka Baszewisa Singera',
      starts_at: '2026-11-04T11:00:00+01:00',
      description: 'Scena: Scena Kameralna/Senatorska 35',
      source_url:
        'https://www.teatr-zydowski.art.pl/spektakle/niewidzialne-basnie-na-podstawie-opowiadan-dla-dzieci-icchoka-baszewisa-singera',
    });
    expect(rows.every((r) => r.starts_at.startsWith('2026-11'))).toBe(true);
  });

  it('produces rows the validator accepts as theatre performances', async () => {
    const rows = parseZydowskiRepertoire(await loadFixture('www.teatr-zydowski.art.pl-repertuar.html'));
    const { valid, invalid } = validateEvents(rows, { category: 'theatre', timezone: 'Europe/Warsaw' });
    expect(invalid).toEqual([]);
    expect(valid).toHaveLength(14);
  });
});

describe('scrapeZydowski', () => {
  const pages = async () => ({
    '2026-11': await loadFixture('www.teatr-zydowski.art.pl-repertuar.html'),
    '2026-12': await loadFixture('www.teatr-zydowski.art.pl-repertuar-2026-12.html'),
  });

  it('reads this month and next from /repertuar/YYYY-MM, whatever URL the venue was added with', async () => {
    const byMonth = await pages();
    const fetched: string[] = [];
    const fetcher = (async (url: string | URL) => {
      fetched.push(String(url));
      const ym = String(url).slice(-7) as keyof typeof byMonth;
      return new Response(byMonth[ym] ?? '', { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeZydowski({
      baseUrl: 'https://www.teatr-zydowski.art.pl/',
      today: new Date('2026-11-04T08:00:00Z'),
      windowDays: 45,
      fetcher,
    });

    expect(fetched).toEqual([
      'https://www.teatr-zydowski.art.pl/repertuar/2026-11',
      'https://www.teatr-zydowski.art.pl/repertuar/2026-12',
    ]);
    // The window ends on 19 December, so December's later shows wait.
    expect(res.events.length).toBe(19);
    expect(res.events.every((e) => e.starts_at.slice(0, 10) <= '2026-12-19')).toBe(true);
    expect(res.coveredThrough).toBeUndefined();
  });

  it('claims only the days it read when a month fails to load', async () => {
    const byMonth = await pages();
    const fetcher = (async (url: string | URL) =>
      String(url).endsWith('2026-11')
        ? new Response(byMonth['2026-11'], { status: 200 })
        : new Response('down', { status: 503 })) as unknown as typeof fetch;

    const res = await scrapeZydowski({
      baseUrl: 'https://www.teatr-zydowski.art.pl/repertuar/',
      today: new Date('2026-11-04T08:00:00Z'),
      windowDays: 45,
      fetcher,
    });
    expect(res.events).toHaveLength(14);
    expect(res.coveredThrough).toBe('2026-11-30');
  });
});

describe('getDeterministicScraper — a venue readers add themselves', () => {
  it('matches Teatr Żydowski by its host, with or without www', () => {
    expect(getDeterministicScraper('some-uuid', 'https://www.teatr-zydowski.art.pl/')).toBeDefined();
    expect(getDeterministicScraper('some-uuid', 'https://teatr-zydowski.art.pl/repertuar')).toBeDefined();
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTeatrZydowskiRepertoire, scrapeTeatrZydowski } from './teatrzydowski.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');
const loadFixture = (name: string) => fs.readFile(path.join(fixtureDir, name), 'utf-8');
const REPERTOIRE = 'www.teatr-zydowski.art.pl-repertuar.html';

describe('parseTeatrZydowskiRepertoire', () => {
  it('reads every dated performance off the live page', async () => {
    const rows = parseTeatrZydowskiRepertoire(await loadFixture(REPERTOIRE));

    expect(rows).toHaveLength(30);
    expect(rows[0]).toMatchObject({
      title: 'Gołda Tencer zaprasza: Szlagiery żydowskiego kabaretu',
      starts_at: '2026-08-14T19:00:00+02:00',
      source_url:
        'https://www.teatr-zydowski.art.pl/spektakle/golda-tencer-zaprasza-szlagiery-zydowskiego-kabaretu',
      description: 'Scena Letnia przy Senatorskiej 35',
    });
  });

  // The printed date is "14.08" with no year on it. The year — and the right
  // offset — are sitting in the RDFa attribute, so nothing is inferred.
  it('takes the instant from the markup rather than the printed date', async () => {
    const rows = parseTeatrZydowskiRepertoire(await loadFixture(REPERTOIRE));
    expect(rows.every((r) => /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\+0[12]:00$/.test(r.starts_at))).toBe(true);
    expect(rows.every((r) => !Number.isNaN(Date.parse(r.starts_at)))).toBe(true);
  });

  // Which stage matters here more than at most venues: the company plays in
  // other people's buildings, including the Opera's main hall.
  it('keeps the stage, including the borrowed ones', async () => {
    const rows = parseTeatrZydowskiRepertoire(await loadFixture(REPERTOIRE));
    const stages = new Set(rows.map((r) => r.description));
    expect(stages.size).toBeGreaterThan(1);
    expect([...stages].some((s) => s?.includes('Teatr Wielki'))).toBe(true);
  });

  // The same play runs a dozen times a month, so the key has to be per
  // performance or a re-scrape collapses the run to one row.
  it('keys each performance separately, and drops exact repeats', async () => {
    const rows = parseTeatrZydowskiRepertoire(await loadFixture(REPERTOIRE));
    const ids = rows.map((r) => r.source_id);
    expect(new Set(ids).size).toBe(ids.length);

    const repeated = rows.filter((r) => r.source_url.endsWith('szlagiery-zydowskiego-kabaretu'));
    expect(repeated.length).toBeGreaterThan(1);
    expect(new Set(repeated.map((r) => r.source_id)).size).toBe(repeated.length);
  });

  it('ignores the header row and anything without a date', () => {
    const rows = parseTeatrZydowskiRepertoire(
      `<table><thead><tr><th>Tytuł</th></tr></thead><tbody>
         <tr><td class="title"><a href="/spektakle/x">Bez daty</a></td></tr>
       </tbody></table>`,
    );
    expect(rows).toEqual([]);
  });
});

describe('scrapeTeatrZydowski', () => {
  const fetcher = (html: string) =>
    (async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;

  it('keeps only what falls inside the scrape window', async () => {
    const html = await loadFixture(REPERTOIRE);
    const { events } = await scrapeTeatrZydowski({
      baseUrl: 'https://www.teatr-zydowski.art.pl/repertuar',
      today: new Date('2026-08-20T09:00:00Z'),
      windowDays: 5, // 20–25 August
      timezone: 'Europe/Warsaw',
      fetcher: fetcher(html),
    });

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const day = e.starts_at.slice(0, 10);
      expect(day >= '2026-08-20' && day <= '2026-08-25').toBe(true);
    }
  });

  it('reports the page as its signature, so an unchanged run skips', async () => {
    const html = await loadFixture(REPERTOIRE);
    const args = {
      baseUrl: 'https://www.teatr-zydowski.art.pl/repertuar',
      today: new Date('2026-08-14T09:00:00Z'),
      windowDays: 30,
      timezone: 'Europe/Warsaw',
      fetcher: fetcher(html),
    };
    const a = await scrapeTeatrZydowski(args);
    const b = await scrapeTeatrZydowski(args);
    expect(a.signature).toBe(b.signature);
    expect(a.events.length).toBe(30);
  });
});

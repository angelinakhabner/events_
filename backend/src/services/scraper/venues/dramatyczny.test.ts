import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRAMATYCZNY_TICKETS_URL, parseDramatycznyTickets, scrapeDramatyczny } from './dramatyczny.js';
import { getDeterministicScraper } from '../deterministic.js';
import { validateEvents } from '../validator.js';
import { showKey } from '../enricher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');
const FIXTURE = 'bilety.teatrdramatyczny.pl-rezerwacja-termin.html.html';
const load = () => fs.readFile(path.join(fixtureDir, FIXTURE), 'utf-8');

/**
 * GOI-150: teatrdramatyczny.pl answers bots with a Cloudflare 403; its ticket
 * office does not, and lists the whole repertoire.
 */
describe('parseDramatycznyTickets', () => {
  it('reads every performance on every stage, sold out or not', async () => {
    const rows = parseDramatycznyTickets(await load());
    expect(rows).toHaveLength(55);
    expect(rows[0]).toMatchObject({
      // Sold out ("Brak miejsc") and still listed.
      title: 'FERDYDURKE',
      starts_at: '2026-11-04T18:30:00+01:00',
      description: 'Scena: Mała Scena',
    });
    // Two stages on one day are two rows.
    const nov6 = rows.filter((r) => r.starts_at.startsWith('2026-11-06'));
    expect(nov6.map((r) => [r.title, r.description])).toEqual([
      ['MISTRZ I MAŁGORZATA', 'Scena: Mała Scena'],
      ['LALKA', 'Scena: Duża Scena'],
    ]);
    expect(rows.at(-1)!.starts_at.startsWith('2026-12-31')).toBe(true);
  });

  it('keys a performance on its start and title, so selling out does not make it a new row', async () => {
    const html = await load();
    const before = parseDramatycznyTickets(html).find((r) => r.starts_at === '2026-11-05T11:00:00+01:00')!;
    // The same performance once its last seat has gone.
    const soldOut = html.replace(
      /(<h3>11:00<\/h3><div class="extra-info">LALKA<\/div><a class="button btn btn-white )" href="[^"]*"/,
      '$1disabled " href="#"',
    );
    const after = parseDramatycznyTickets(soldOut).find((r) => r.starts_at === '2026-11-05T11:00:00+01:00')!;
    expect(after.source_id).toBe(before.source_id);
    expect(after.source_url).toBe(before.source_url);
  });

  it('links each row to the repertoire, so descriptions are written once per title', async () => {
    const rows = parseDramatycznyTickets(await load());
    const venueUrl = 'https://teatrdramatyczny.pl/repertuar/';
    expect(new Set(rows.map((r) => r.source_url))).toEqual(new Set([venueUrl]));
    // Enrichment compares against the venue URL as it normalises it.
    expect(showKey(rows[0]!, 'https://teatrdramatyczny.pl/repertuar')).toBe('title:ferdydurke');
  });

  it('produces rows the validator accepts as theatre performances', async () => {
    const rows = parseDramatycznyTickets(await load());
    const { valid, invalid } = validateEvents(rows, { category: 'theatre', timezone: 'Europe/Warsaw' });
    expect(invalid).toEqual([]);
    expect(valid).toHaveLength(55);
  });
});

describe('scrapeDramatyczny', () => {
  it('reads the ticket office whatever URL the venue carries, and keeps the window', async () => {
    const html = await load();
    const fetched: string[] = [];
    const fetcher = (async (url: string | URL) => {
      fetched.push(String(url));
      return new Response(html, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeDramatyczny({
      baseUrl: 'https://teatrdramatyczny.pl/repertuar/',
      today: new Date('2026-11-10T08:00:00Z'),
      windowDays: 20,
      fetcher,
    });
    expect(fetched).toEqual([DRAMATYCZNY_TICKETS_URL]);
    expect(res.events.length).toBeGreaterThan(0);
    expect(res.events.every((e) => e.starts_at >= '2026-11-10' && e.starts_at.slice(0, 10) <= '2026-11-30')).toBe(true);
  });

  it('is what the curated venue is read with', () => {
    expect(getDeterministicScraper('any-db-id', 'https://teatrdramatyczny.pl/repertuar/')).toBeDefined();
  });
});

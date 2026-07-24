import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePowszechnyRepertoire, scrapePowszechny } from './powszechny.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');

const loadFixture = (name: string) => fs.readFile(path.join(fixtureDir, name), 'utf-8');
const FIXTURE = 'powszechny.com-api-repertoire-lang-pl.html';

describe('parsePowszechnyRepertoire', () => {
  it('parses the live API capture: every published showing survives', async () => {
    const events = parsePowszechnyRepertoire(await loadFixture(FIXTURE));
    // The capture holds 39 events, none hidden.
    expect(events).toHaveLength(39);
  });

  it('maps the API fields onto validator-shaped rows', async () => {
    const events = parsePowszechnyRepertoire(await loadFixture(FIXTURE));
    const lisa = events.find((e) => e.starts_at === '2026-07-11T17:30:00.000Z');

    expect(lisa).toBeDefined();
    expect(lisa!.title).toBe('Lisa');
    expect(lisa!.duration_minutes).toBe(90);
    expect(lisa!.source_url).toBe('https://powszechny.com/pl/spektakle/lisa');
    expect(lisa!.source_id).toBe('bf09b7fd-c239-4c83-94da-080b80ff1613');
    // "PREMIERA!" badge + stage, no generic "Spektakl" category noise.
    expect(lisa!.description).toBe('PREMIERA! — Scena: scena mała');
  });

  it('derives the show URL language segment from the listing URL', async () => {
    const events = parsePowszechnyRepertoire(
      await loadFixture(FIXTURE),
      'https://powszechny.com/en/repertuar?miesiac=2026-07',
    );
    expect(events[0]!.source_url).toMatch(/^https:\/\/powszechny\.com\/en\/spektakle\//);
  });

  it('drops hidden rows and rows without a title or parsable date', () => {
    const events = parsePowszechnyRepertoire(
      JSON.stringify({
        events: [
          { title: 'Hidden', date: '2026-09-01T18:00:00.000Z', hiddenFromRepertoire: true },
          { title: '', date: '2026-09-01T18:00:00.000Z' },
          { title: 'Bad date', date: 'someday' },
          { title: 'Kept', date: '2026-09-01T18:00:00.000Z', repertoireEventId: 'id-1' },
        ],
      }),
    );
    expect(events.map((e) => e.title)).toEqual(['Kept']);
  });

  it('returns [] for malformed or shell payloads instead of throwing', () => {
    expect(parsePowszechnyRepertoire('<!doctype html><html></html>')).toEqual([]);
    expect(parsePowszechnyRepertoire('{"notEvents":[]}')).toEqual([]);
  });
});

describe('scrapePowszechny', () => {
  it('hits /api/repertoire on the venue origin and keeps in-window rows', async () => {
    const body = await loadFixture(FIXTURE);
    const requested: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      requested.push(String(url));
      return new Response(body, { status: 200 });
    }) as typeof fetch;

    const res = await scrapePowszechny({
      baseUrl: 'https://powszechny.com/pl/repertuar?miesiac=2026-07',
      today: new Date('2026-07-10T06:00:00Z'),
      windowDays: 7,
      fetcher,
    });

    expect(requested).toEqual(['https://powszechny.com/api/repertoire?lang=pl']);
    // The capture has exactly 4 showings on Jul 10–17 (Jul 11, 12, 14, 15).
    expect(res.events).toHaveLength(4);
    expect(res.events.every((e) => e.starts_at >= '2026-07-10' && e.starts_at < '2026-07-18')).toBe(true);
    expect(res.signature).toBe(body);
  });

  it('returns an empty (not failed) result for a genuinely dark window', async () => {
    const body = await loadFixture(FIXTURE);
    const fetcher = (async () => new Response(body, { status: 200 })) as typeof fetch;
    // Aug 2026 is the theatre's summer break in the capture.
    const res = await scrapePowszechny({
      baseUrl: 'https://powszechny.com/pl/repertuar',
      today: new Date('2026-08-01T06:00:00Z'),
      windowDays: 14,
      fetcher,
    });
    expect(res.events).toEqual([]);
  });
});

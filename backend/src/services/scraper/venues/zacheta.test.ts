import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inferIsoDay, parseEventDate, parseZachetaCalendar, scrapeZacheta } from './zacheta.js';

// Real capture of https://zacheta.art.pl/pl/kalendarz (GOI-31).
const FIXTURE = readFileSync(
  join(process.cwd(), 'test/fixtures/zacheta.art.pl-pl-kalendarz.html'),
  'utf8',
);
// The fixture's first day. Anchoring "today" to it keeps the year inference
// deterministic regardless of when the suite runs.
const TODAY = '2026-07-29';

describe('parseEventDate', () => {
  it('reads day, month, weekday and time', () => {
    expect(parseEventDate('29.07 (ŚR) 18:00')).toEqual({
      day: 29, month: 7, weekday: 3, hour: '18:00',
    });
  });

  it('handles every Polish weekday abbreviation the calendar prints', () => {
    const days = { ND: 0, PN: 1, WT: 2, 'ŚR': 3, CZW: 4, PT: 5, SOB: 6 };
    for (const [abbr, num] of Object.entries(days)) {
      expect(parseEventDate(`01.08 (${abbr}) 12:00`)?.weekday).toBe(num);
    }
  });

  it('rejects an exhibition date range', () => {
    // Exhibitions carry "01.05 – 20.09.2026" — a run, not a start instant.
    expect(parseEventDate('01.05 – 20.09.2026')).toBeNull();
  });

  it('rejects impossible or malformed values', () => {
    expect(parseEventDate('32.07 (ŚR) 18:00')).toBeNull();
    expect(parseEventDate('29.13 (ŚR) 18:00')).toBeNull();
    expect(parseEventDate('29.07 18:00')).toBeNull();
    expect(parseEventDate('')).toBeNull();
  });

  it('survives an unknown weekday token rather than dropping the row', () => {
    // Better to fall back to plain roll-forward than to lose the event.
    expect(parseEventDate('29.07 (XX) 18:00')).toMatchObject({ day: 29, weekday: null });
  });
});

describe('inferIsoDay', () => {
  it('keeps the current year for a date ahead of today', () => {
    expect(inferIsoDay(29, 7, 3, TODAY)).toBe('2026-07-29');
  });

  it('rolls into next year when the month is already behind', () => {
    // The calendar only lists upcoming dates, so January seen in July is next
    // year's January.
    expect(inferIsoDay(15, 1, null, TODAY)).toBe('2027-01-15');
  });

  it('lets the printed weekday correct the rolled-forward guess', () => {
    // 15.01.2027 is a Friday; 15.01.2026 was a Thursday. Asking for Thursday
    // must pick the *earlier* year rather than trusting the roll-forward.
    expect(inferIsoDay(15, 1, 5, TODAY)).toBe('2027-01-15');
    expect(inferIsoDay(15, 1, 4, TODAY)).toBe('2026-01-15');
  });

  it('keeps a date a few days behind today in the current year', () => {
    // A week of slack, so a listing still showing yesterday isn't thrown a
    // year forward.
    expect(inferIsoDay(27, 7, null, TODAY)).toBe('2026-07-27');
  });

  it('returns null for a date that does not exist', () => {
    // JS would silently roll 31.02 into March; the parser must not.
    expect(inferIsoDay(31, 2, null, TODAY)).toBeNull();
  });

  it('returns null when no neighbouring year matches the weekday', () => {
    // 29.07 is Wed 2026, Tue 2025, Thu 2027 — Sunday matches none of them.
    expect(inferIsoDay(29, 7, 0, TODAY)).toBeNull();
  });
});

describe('parseZachetaCalendar (real fixture)', () => {
  const rows = parseZachetaCalendar(FIXTURE, TODAY, 'Europe/Warsaw');

  it('extracts every dated event on the page', () => {
    // 184 list items, of which 40 are `is-event`; the rest are exhibition runs.
    expect(rows).toHaveLength(40);
  });

  it('ignores exhibition runs, which have no start instant', () => {
    // Every row must be a real timestamp, not a date range.
    for (const r of rows) {
      expect(r.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    }
  });

  it('stamps the Warsaw offset, not UTC', () => {
    // Late July is CEST (+02:00).
    expect(rows[0]!.starts_at).toBe('2026-07-29T18:00:00+02:00');
  });

  it('returns rows in ascending start order across the whole window', () => {
    const starts = rows.map((r) => r.starts_at);
    expect([...starts].sort()).toEqual(starts);
    expect(starts[starts.length - 1]!.slice(0, 10)).toBe('2026-08-27');
  });

  it('carries titles, absolute links and per-occurrence ids', () => {
    const guided = rows.find((r) => r.title === 'Czwartkowe oprowadzania po aktualnych wystawach');
    expect(guided).toBeDefined();
    expect(guided!.source_url).toMatch(/^https:\/\/zacheta\.art\.pl\/pl\/kalendarz\//);
    expect(guided!.source_id).toBeTruthy();
  });

  it('gives recurring programmes distinct ids per occurrence', () => {
    // "Czwartkowe oprowadzania" runs weekly; each must be its own row, or the
    // persister would collapse the series into one.
    const recurring = rows.filter((r) => r.title.startsWith('Czwartkowe oprowadzania'));
    expect(recurring.length).toBeGreaterThan(1);
    expect(new Set(recurring.map((r) => r.source_id)).size).toBe(recurring.length);
  });

  it('records the venue in the description rather than the title', () => {
    const withVenue = rows.filter((r) => r.description?.includes('Miejsce:'));
    expect(withVenue.length).toBeGreaterThan(0);
    expect(withVenue[0]!.title).not.toContain('Miejsce:');
  });

  it('never emits a duplicate id', () => {
    const ids = rows.map((r) => r.source_id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('scrapeZacheta', () => {
  const fetcherFor = (html: string) => {
    const seen: string[] = [];
    const fetcher = (async (url: string | URL) => {
      seen.push(url.toString());
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    return { fetcher, seen };
  };

  it('fetches the calendar once and bounds rows to the window', async () => {
    const { fetcher, seen } = fetcherFor(FIXTURE);
    const res = await scrapeZacheta({
      baseUrl: 'https://zacheta.art.pl/pl/kalendarz',
      today: new Date('2026-07-29T08:00:00Z'),
      windowDays: 7,
      timezone: 'Europe/Warsaw',
      fetcher,
    });
    expect(seen).toHaveLength(1);
    // The page runs a month out; a 7-day window must not smuggle in the rest,
    // or the runner's stale-prune would later read them as missing.
    expect(res.events.length).toBeGreaterThan(0);
    expect(res.events.length).toBeLessThan(40);
    for (const e of res.events) {
      expect(e.starts_at.slice(0, 10) >= '2026-07-29').toBe(true);
      expect(e.starts_at.slice(0, 10) <= '2026-08-05').toBe(true);
    }
  });

  it('redirects a homepage-seeded URL to the calendar', async () => {
    // Databases seeded before the 0015 migration still hold /en, which has no
    // listing at all. Failing there would be a silent zero-event venue.
    const { fetcher, seen } = fetcherFor(FIXTURE);
    await scrapeZacheta({
      baseUrl: 'https://zacheta.art.pl/en',
      today: new Date('2026-07-29T08:00:00Z'),
      windowDays: 30,
      fetcher,
    });
    expect(seen[0]).toBe('https://zacheta.art.pl/pl/kalendarz');
  });

  it('returns the page as its change signature', async () => {
    const { fetcher } = fetcherFor(FIXTURE);
    const res = await scrapeZacheta({
      baseUrl: 'https://zacheta.art.pl/pl/kalendarz',
      today: new Date('2026-07-29T08:00:00Z'),
      windowDays: 30,
      fetcher,
    });
    expect(res.signature).toBe(FIXTURE);
  });
});

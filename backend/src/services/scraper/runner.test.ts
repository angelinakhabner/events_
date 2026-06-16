import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

// In-memory DB fake. The shape matches the parts of Drizzle that runner.ts uses.
interface ScrapeRunRow {
  id: string;
  venueId: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  eventsFound: number | null;
  errorMessage: string | null;
  rawHash: string | null;
}

interface VenueRow {
  id: string; name: string; url: string; city: string; country: string;
  category: string; language: string; timezone: string; createdAt: Date;
}

const state: { venues: VenueRow[]; runs: ScrapeRunRow[]; events: any[] } = {
  venues: [],
  runs: [],
  events: [],
};

const fakeDb = {
  select: () => ({
    from: (table: any) => ({
      where: (_cond: any) => ({
        orderBy: (_o: any) => ({
          limit: (_n: number) => {
            if (table === '__scrapeRuns__') {
              return state.runs
                .filter((r) => r.status === 'success' || r.status === 'success_empty')
                .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
                .slice(0, 1);
            }
            return [];
          },
        }),
        limit: (_n: number) => {
          if (table === '__venues__') return state.venues.slice(0, 1);
          if (table === '__scrapeRuns__') {
            // For finalize's re-fetch — return the most recently inserted run.
            const r = state.runs[state.runs.length - 1];
            return r ? [r] : [];
          }
          return [];
        },
      }),
    }),
  }),
  insert: (table: any) => ({
    values: (vals: any) => ({
      returning: () => {
        if (table === '__scrapeRuns__') {
          const row: ScrapeRunRow = {
            id: `run-${state.runs.length + 1}`,
            venueId: vals.venueId,
            startedAt: vals.startedAt ?? new Date(),
            finishedAt: null,
            status: vals.status,
            eventsFound: null,
            errorMessage: null,
            rawHash: null,
          };
          state.runs.push(row);
          return [row];
        }
        return [];
      },
    }),
  }),
  update: (_table: any) => ({
    set: (_patch: any) => ({
      where: (_w: any) => Promise.resolve(),
    }),
  }),
  // Runner now uses db.execute(sql`UPDATE scrape_runs ... RETURNING ...`).
  // Extract the bound Param values from drizzle's sql template chunks
  // (in finalize's order: status, eventsFound, errorMessage, rawHash,
  // finishedAt, id) and apply them to the most recent run.
  execute: async (frag: any) => {
    // Our mocked drizzle-orm `sql` tag stores values under `__params`.
    // finalize now issues two execute calls:
    //   UPDATE: [status, eventsFound, errorMessage, rawHash, finishedAt, id]
    //   SELECT: [id]
    const params: any[] = Array.isArray(frag?.__params) ? frag.__params : [];
    if (params.length === 1) {
      const id = params[0];
      const r = state.runs.find((x) => x.id === id);
      if (r) {
        return {
          rows: [{
            id: r.id, venue_id: r.venueId, started_at: r.startedAt,
            finished_at: r.finishedAt, status: r.status,
            events_found: r.eventsFound, error_message: r.errorMessage,
            raw_hash: r.rawHash,
          }],
        };
      }
      return { rows: [] };
    }
    if (params.length === 6) {
      const [status, eventsFound, errorMessage, rawHash, finishedAt, id] = params;
      const r = state.runs.find((x) => x.id === id);
      if (r) {
        Object.assign(r, { status, eventsFound, errorMessage, rawHash, finishedAt });
      }
      return { rows: [] };
    }
    return { rows: [{ inserted: true }] };
  },
};

vi.mock('../../db/index.js', () => ({
  getDb: () => fakeDb,
  schema: {
    venues: '__venues__',
    scrapeRuns: '__scrapeRuns__',
    events: '__events__',
  },
}));

// Mock drizzle-orm helpers since runner imports them and our schema is just strings.
vi.mock('drizzle-orm', async () => {
  return {
    // Preserve the interpolated values so the fake db can read them back.
    sql: (_strings: TemplateStringsArray, ...values: unknown[]) => ({ __params: values }),
    eq: (..._a: any[]) => ({}),
    desc: (..._a: any[]) => ({}),
    and: (..._a: any[]) => ({}),
    inArray: (..._a: any[]) => ({}),
    ilike: (..._a: any[]) => ({}),
    or: (..._a: any[]) => ({}),
    gte: (..._a: any[]) => ({}),
    asc: (..._a: any[]) => ({}),
  };
});

// Stub persister to avoid touching SQL.
vi.mock('./persister.js', () => ({
  saveEvents: vi.fn(async () => ({ inserted: 1, updated: 0 })),
}));

import { scrapeVenue } from './runner.js';

const VENUE: VenueRow = {
  id: 'venue-1',
  name: 'Kino Test',
  url: 'https://example.test',
  city: 'Warsaw',
  country: 'PL',
  category: 'cinema',
  language: 'pl',
  timezone: 'Europe/Warsaw',
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

const HTML_SAMPLE = '<div id="calendar-wrapper"><div class="calendar-seance-full__month-label">Czerwiec 2026</div><div class="movie-calendar-info"><span class="movie-calendar-info__date">17:00</span><h5 class="movie-calendar-info__title">A</h5></div></div>';

// One well-formed extractor row (matches the validator schema) for the
// success-path tests. starts_at is a real evening showtime, not midnight.
const EVENT_FIELDS = {
  title: 'A',
  starts_at: '2026-06-17T17:00:00+02:00',
  duration_minutes: null,
  language: null,
  director: null,
  cast: null,
  description: null,
  price_min: null,
  price_max: null,
  source_url: 'https://example.test/film/a',
  source_id: '1',
};
const EVENT_JSON = JSON.stringify([EVENT_FIELDS]);

beforeEach(() => {
  state.venues = [VENUE];
  state.runs = [];
  state.events = [];
});

describe('scrapeVenue runner', () => {
  it('skips when hash unchanged and Claude is NOT called', async () => {
    const extractor = { extract: vi.fn(async () => '[]') };
    // Pre-seed a successful run with the hash of the upcoming HTML.
    const html = HTML_SAMPLE;
    // First scrape to seed a successful run.
    await scrapeVenue('venue-1', {
      htmlOverride: html,
      extractor: { extract: async () => '[]' },
    });
    extractor.extract.mockClear();

    // Second scrape with identical HTML.
    const run = await scrapeVenue('venue-1', { htmlOverride: html, extractor });
    expect(run.status).toBe('skipped_unchanged');
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  it('runs full pipeline when hash changes', async () => {
    const extractor = { extract: vi.fn(async () => EVENT_JSON) };
    const run = await scrapeVenue('venue-1', { htmlOverride: HTML_SAMPLE, extractor });
    expect(run.status).toBe('success');
    expect(run.eventsFound).toBe(1);
    expect(extractor.extract).toHaveBeenCalledTimes(1);
  });

  it('records status=success_empty when the extractor returns no usable events', async () => {
    const extractor = { extract: vi.fn(async () => '[]') };
    const run = await scrapeVenue('venue-1', { htmlOverride: HTML_SAMPLE, extractor });
    expect(run.status).toBe('success_empty');
    expect(run.eventsFound).toBe(0);
  });

  it('rejects midnight showtimes for a timed venue → success_empty, not a wrong 00:00', async () => {
    const midnight = JSON.stringify([
      { ...EVENT_FIELDS, starts_at: '2026-06-17T00:00:00+02:00' },
    ]);
    const extractor = { extract: vi.fn(async () => midnight) };
    const run = await scrapeVenue('venue-1', { htmlOverride: HTML_SAMPLE, extractor });
    expect(run.status).toBe('success_empty');
    expect(run.eventsFound).toBe(0);
  });

  it('records status=failed when fetcher throws', async () => {
    const failingFetcher = vi.fn(async () => {
      throw new Error('network exploded');
    });
    const run = await scrapeVenue('venue-1', {
      fetcher: failingFetcher as unknown as typeof fetch,
      extractor: { extract: async () => '[]' },
    });
    expect(run.status).toBe('failed');
    expect(run.errorMessage).toMatch(/network exploded/);
  });

  it('re-runs the pipeline when a prior success was stored under a different hash version', async () => {
    // Simulate a successful run cached under an old version's hash. Same HTML
    // arriving now should produce a NEW hash (because EXTRACTOR_VERSION is
    // mixed in), so the cache check misses and Claude runs again.
    const html = HTML_SAMPLE;
    state.runs.push({
      id: 'stale',
      venueId: 'venue-1',
      startedAt: new Date(),
      finishedAt: new Date(),
      status: 'success',
      eventsFound: 0,
      errorMessage: null,
      rawHash: 'hash-from-an-older-extractor-version', // deliberately wrong
    });
    // Return a real event so success is genuine — this test is about the hash
    // version forcing a re-run, not about empty-result handling.
    const extractor = { extract: vi.fn(async () => EVENT_JSON) };
    const run = await scrapeVenue('venue-1', { htmlOverride: html, extractor });
    expect(run.status).toBe('success');
    expect(extractor.extract).toHaveBeenCalledTimes(1);
  });
});

describe('countCalendarFallbacks', () => {
  it('counts events whose source_url matches the venue url', async () => {
    const { countCalendarFallbacks } = await import('./runner.js');
    const events = [
      { source_url: 'https://venue.example/repertuar' },
      { source_url: 'https://venue.example/film/a' },
      { source_url: 'https://venue.example/film/b' },
    ];
    expect(countCalendarFallbacks(events, 'https://venue.example/repertuar')).toBe(1);
  });

  it('normalises trailing slash and case', async () => {
    const { countCalendarFallbacks } = await import('./runner.js');
    expect(
      countCalendarFallbacks(
        [{ source_url: 'HTTPS://Venue.example/Repertuar/' }],
        'https://venue.example/repertuar',
      ),
    ).toBe(1);
  });

  it('returns 0 when every event has a per-event URL', async () => {
    const { countCalendarFallbacks } = await import('./runner.js');
    expect(
      countCalendarFallbacks(
        [{ source_url: 'https://v/film/a' }, { source_url: 'https://v/film/b' }],
        'https://v/repertuar',
      ),
    ).toBe(0);
  });
});

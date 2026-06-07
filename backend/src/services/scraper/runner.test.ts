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
                .filter((r) => r.status === 'success')
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
  update: (table: any) => ({
    set: (patch: any) => ({
      where: (_w: any) => {
        // Apply the patch synchronously so the chained `await` resolves
        // after the in-memory mutation. Runner no longer calls .returning().
        if (table === '__scrapeRuns__') {
          const r = state.runs[state.runs.length - 1]!;
          Object.assign(r, patch);
        }
        return Promise.resolve();
      },
    }),
  }),
  execute: async (_sql: any) => ({ rows: [{ inserted: true }] }),
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
    sql: (..._a: any[]) => ({}),
    eq: (..._a: any[]) => ({}),
    desc: (..._a: any[]) => ({}),
    and: (..._a: any[]) => ({}),
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
    const extractor = { extract: vi.fn(async () => '[]') };
    const run = await scrapeVenue('venue-1', { htmlOverride: HTML_SAMPLE, extractor });
    expect(run.status).toBe('success');
    expect(extractor.extract).toHaveBeenCalledTimes(1);
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
});

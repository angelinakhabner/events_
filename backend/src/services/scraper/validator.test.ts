import { describe, it, expect } from 'vitest';
import { validateEvents } from './validator.js';

describe('validateEvents', () => {
  it('returns empty for an empty array', () => {
    expect(validateEvents([])).toEqual({ valid: [], invalid: [] });
  });

  it('reports invalid when top-level value is not an array', () => {
    const r = validateEvents('not an array' as unknown);
    expect(r.valid).toEqual([]);
    expect(r.invalid).toHaveLength(1);
  });

  it('skips bad entries and keeps good ones — never crashes', () => {
    const r = validateEvents([
      // good
      {
        title: 'Tajny agent',
        starts_at: '2026-06-08T17:00:00+02:00',
        duration_minutes: null,
        language: null,
        director: null,
        cast: null,
        description: null,
        price_min: null,
        price_max: null,
        source_url: 'https://kinomuranow.pl/film/tajny-agent',
        source_id: '26919',
      },
      // bad: missing title
      { starts_at: '2026-06-08T18:00:00+02:00', source_url: 'https://x' },
      // bad: invalid timestamp
      {
        title: 'X',
        starts_at: 'not a date',
        duration_minutes: null,
        language: null,
        director: null,
        cast: null,
        description: null,
        price_min: null,
        price_max: null,
        source_url: 'https://x',
        source_id: null,
      },
      // bad: invalid url
      {
        title: 'Y',
        starts_at: '2026-06-08T19:00:00+02:00',
        duration_minutes: null,
        language: null,
        director: null,
        cast: null,
        description: null,
        price_min: null,
        price_max: null,
        source_url: 'not-a-url',
        source_id: null,
      },
    ]);
    expect(r.valid.map((e) => e.title)).toEqual(['Tajny agent']);
    expect(r.invalid).toHaveLength(3);
    for (const i of r.invalid) expect(typeof i.error).toBe('string');
  });

  it('trims and collapses internal whitespace in titles, preserving diacritics', () => {
    const r = validateEvents([
      {
        title: '  Drugie  życie\n',
        starts_at: '2026-06-08T18:00:00+02:00',
        duration_minutes: null,
        language: null,
        director: null,
        cast: null,
        description: null,
        price_min: null,
        price_max: null,
        source_url: 'https://kinomuranow.pl/film/drugie-zycie',
        source_id: null,
      },
    ]);
    expect(r.valid[0]!.title).toBe('Drugie życie');
  });

  it('rejects local-midnight starts for timed venues (missing showtime)', () => {
    const entry = {
      title: 'Rozmowa',
      starts_at: '2026-06-16T00:00:00+02:00', // 00:00 Warsaw
      duration_minutes: null,
      language: null,
      director: null,
      cast: null,
      description: null,
      price_min: null,
      price_max: null,
      source_url: 'https://kinoteka.pl/film/rozmowa',
      source_id: null,
    };
    const r = validateEvents([entry], { category: 'cinema', timezone: 'Europe/Warsaw' });
    expect(r.valid).toHaveLength(0);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]!.error).toMatch(/midnight/i);
  });

  it('allows local-midnight starts for all-day exhibitions', () => {
    const entry = {
      title: 'After the Future',
      starts_at: '2026-06-16T00:00:00+02:00',
      duration_minutes: null,
      language: null,
      director: null,
      cast: null,
      description: null,
      price_min: null,
      price_max: null,
      source_url: 'https://zacheta.art.pl/wystawa',
      source_id: null,
    };
    const r = validateEvents([entry], { category: 'exhibition', timezone: 'Europe/Warsaw' });
    expect(r.valid).toHaveLength(1);
  });

  it('keeps real evening showtimes for timed venues', () => {
    const entry = {
      title: 'Dzień objawienia',
      starts_at: '2026-06-16T11:00:00+02:00',
      duration_minutes: null,
      language: null,
      director: null,
      cast: null,
      description: null,
      price_min: null,
      price_max: null,
      source_url: 'https://kinoteka.pl/film/dzien',
      source_id: null,
    };
    const r = validateEvents([entry], { category: 'cinema', timezone: 'Europe/Warsaw' });
    expect(r.valid).toHaveLength(1);
  });

  it('treats missing source_id as null', () => {
    const r = validateEvents([
      {
        title: 'X',
        starts_at: '2026-06-08T17:00:00+02:00',
        duration_minutes: null,
        language: null,
        director: null,
        cast: null,
        description: null,
        price_min: null,
        price_max: null,
        source_url: 'https://x.example',
      },
    ]);
    expect(r.valid[0]!.source_id).toBeNull();
  });
});

// ─── kind / ends_at invariants (GOI-67) ──────────────────────────────────────

/** A well-formed row, so each case below varies exactly one thing. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Trzy przestrzenie podziemne',
    starts_at: '2026-06-12T00:00:00+02:00',
    duration_minutes: null,
    language: null,
    director: null,
    cast: null,
    description: null,
    price_min: null,
    price_max: null,
    source_url: 'https://msn.example/wystawa/trzy-przestrzenie',
    source_id: null,
    ...overrides,
  };
}

const museum = { category: 'exhibition', timezone: 'Europe/Warsaw' } as const;

describe('validateEvents — exhibition invariants (GOI-67)', () => {
  it('accepts an exhibition carrying a date range', () => {
    const r = validateEvents(
      [row({ kind: 'exhibition', ends_at: '2026-09-14T00:00:00+02:00' })],
      museum,
    );
    expect(r.invalid).toEqual([]);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.kind).toBe('exhibition');
    expect(r.valid[0]!.ends_at).toBe('2026-09-14T00:00:00+02:00');
  });

  it('rejects an exhibition with no ends_at — that is the missing-hour bug again', () => {
    const r = validateEvents([row({ kind: 'exhibition', ends_at: null })], museum);
    expect(r.valid).toEqual([]);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]!.error).toMatch(/ends_at/);
  });

  it('rejects an exhibition whose ends_at precedes starts_at', () => {
    const r = validateEvents(
      [row({ kind: 'exhibition', ends_at: '2026-05-01T00:00:00+02:00' })],
      museum,
    );
    expect(r.valid).toEqual([]);
    expect(r.invalid[0]!.error).toMatch(/before starts_at/);
  });

  it('rejects a timed row that spans days — it is a mislabelled run', () => {
    const r = validateEvents(
      [row({ kind: 'timed', starts_at: '2026-06-12T17:30:00+02:00', ends_at: '2026-09-14T00:00:00+02:00' })],
      museum,
    );
    expect(r.valid).toEqual([]);
    expect(r.invalid[0]!.error).toMatch(/may not span days/);
  });

  it('rejects an unknown kind', () => {
    const r = validateEvents([row({ kind: 'ongoing' })], museum);
    expect(r.valid).toEqual([]);
    expect(r.invalid).toHaveLength(1);
  });

  it('defaults a row with no kind to timed — deterministic scrapers omit it', () => {
    const r = validateEvents([row({ starts_at: '2026-06-12T17:30:00+02:00' })], museum);
    expect(r.valid[0]!.kind).toBe('timed');
    expect(r.valid[0]!.ends_at).toBeNull();
  });

  it('keeps a museum exhibition at local midnight — that is what "no hour" looks like', () => {
    const r = validateEvents(
      [row({ kind: 'exhibition', ends_at: '2026-09-14T00:00:00+02:00' })],
      { category: 'cinema', timezone: 'Europe/Warsaw' },
    );
    // Even at a "timed" venue the midnight guard must not fire on a row that
    // has declared itself a run — the guard exists to catch missing showtimes.
    expect(r.valid).toHaveLength(1);
  });

  it('still rejects a midnight timed row at a timed venue', () => {
    const r = validateEvents(
      [row({ kind: 'timed' })],
      { category: 'cinema', timezone: 'Europe/Warsaw' },
    );
    expect(r.valid).toEqual([]);
    expect(r.invalid[0]!.error).toMatch(/local midnight/);
  });
});

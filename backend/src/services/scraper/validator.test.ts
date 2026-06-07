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

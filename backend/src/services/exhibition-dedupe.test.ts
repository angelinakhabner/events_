import { describe, it, expect } from 'vitest';
import { collapseDuplicateExhibitions, titleKey, type Event } from '@afisz/shared';
import { uniqueExhibitions } from './scraper/persister.js';
import type { ValidatedEvent } from './scraper/validator.js';

function ev(over: Partial<Event> = {}): Event {
  return {
    id: 'e1',
    venueId: 'polin',
    title: 'Betty Q: Morte',
    description: 'An exhibition by Betty Q titled "Morte" at POLIN Museum, with free admission.',
    startsAt: '2026-06-01T00:00:00+02:00',
    endsAt: '2026-09-30T00:00:00+02:00',
    kind: 'exhibition',
    category: 'exhibition',
    language: 'pl',
    director: null,
    cast: [],
    durationMinutes: null,
    priceMin: null,
    priceMax: null,
    sourceUrl: 'https://polin.pl/en/kalendarium',
    sourceId: null,
    scrapedAt: '2026-09-29T00:00:00Z',
    ...over,
  };
}

describe('titleKey', () => {
  it('ignores case, quote style and punctuation', () => {
    expect(titleKey('Rotating Gallery: Boundary Questions')).toBe(titleKey('rotating gallery — "Boundary Questions"'));
  });

  it('keeps different titles apart', () => {
    expect(titleKey('Betty Q: Morte')).not.toBe(titleKey('Rotating Gallery: Boundary Questions'));
  });
});

/** GOI-133: the museums tab listed "Betty Q: Morte · until 30 Sep" twice. */
describe('collapseDuplicateExhibitions', () => {
  it('lists one exhibition once, keeping the first copy', () => {
    const out = collapseDuplicateExhibitions([
      ev({ id: 'a' }),
      ev({ id: 'b', description: "An exhibition by Betty Q titled 'Morte', displayed at Muzeum POLIN." }),
      ev({ id: 'c', title: 'Rotating Gallery: Boundary Questions' }),
      ev({ id: 'd', title: 'Rotating Gallery — Boundary Questions', sourceUrl: 'https://polin.pl/pl/x' }),
    ]);
    expect(out.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('folds copies whose closing dates disagree — one show, read twice', () => {
    const out = collapseDuplicateExhibitions([
      ev({ id: 'a' }),
      ev({ id: 'b', endsAt: '2026-10-01T00:00:00+02:00' }),
    ]);
    expect(out.map((e) => e.id)).toEqual(['a']);
  });

  it('borrows a description from a later copy when the kept one has none', () => {
    const out = collapseDuplicateExhibitions([ev({ id: 'a', description: null }), ev({ id: 'b' })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('a');
    expect(out[0]!.description).toMatch(/Betty Q/);
  });

  it('keeps the same title at two venues', () => {
    expect(collapseDuplicateExhibitions([ev({ id: 'a' }), ev({ id: 'b', venueId: 'msn' })])).toHaveLength(2);
  });

  it('never folds timed rows — three performances are three rows', () => {
    const out = collapseDuplicateExhibitions([
      ev({ id: 'a', kind: 'timed', startsAt: '2026-10-01T19:00:00+02:00', endsAt: null }),
      ev({ id: 'b', kind: 'timed', startsAt: '2026-10-02T19:00:00+02:00', endsAt: null }),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('uniqueExhibitions (persister, GOI-133)', () => {
  const row = (over: Partial<ValidatedEvent>): ValidatedEvent => ({
    title: 'Betty Q: Morte',
    kind: 'exhibition',
    starts_at: '2026-06-01T00:00:00+02:00',
    ends_at: '2026-09-30T00:00:00+02:00',
    description: null,
    source_url: 'https://polin.pl/en/kalendarium',
    ...over,
  } as ValidatedEvent);

  it('saves one row per exhibition in a batch', () => {
    const out = uniqueExhibitions([
      row({ source_url: 'https://polin.pl/a' }),
      row({ source_url: 'https://polin.pl/b', starts_at: '2026-09-29T00:00:00+02:00', description: 'Morte.' }),
      row({ title: 'Other', kind: 'timed', starts_at: '2026-10-01T19:00:00+02:00', ends_at: null }),
      row({ title: 'Other', kind: 'timed', starts_at: '2026-10-02T19:00:00+02:00', ends_at: null }),
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]!.source_url).toBe('https://polin.pl/a');
    expect(out[0]!.description).toBe('Morte.');
  });
});

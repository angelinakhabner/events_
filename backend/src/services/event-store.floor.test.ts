import { describe, it, expect } from 'vitest';
import type { Category, Event } from '@afisz/shared';
import {
  FEED_CATEGORIES, MIN_EVENTS_PER_CATEGORY, UPCOMING_WINDOW_DAYS,
  categoriesBelowFloor, mergeUpcoming,
} from './event-store.js';

/**
 * The per-category floor (GOI-85), as arithmetic.
 *
 * The query that acts on this needs a database; the rule deciding *which*
 * categories to reach further out for does not, so it lives here where the
 * edge cases are cheap to pin down. The end-to-end behaviour — a theatre two
 * months out surviving a wall of cinema — is covered in the home-feed
 * integration suite.
 */

const ev = (id: string, category: Category, startsAt: string): Event =>
  ({ id, category, startsAt } as Event);

const many = (category: Category, n: number, from = 1): Event[] =>
  Array.from({ length: n }, (_, i) => ev(`${category}-${i}`, category, `2026-08-${String(from + i).padStart(2, '0')}T18:00:00Z`));

describe('categoriesBelowFloor', () => {
  it('names a category with nothing at all', () => {
    expect(categoriesBelowFloor(many('cinema', 40), ['cinema', 'theatre'])).toEqual(['theatre']);
  });

  it('names a category that is present but short', () => {
    const events = [...many('cinema', 40), ...many('music', 2)];
    expect(categoriesBelowFloor(events, ['cinema', 'music'])).toEqual(['music']);
  });

  // Exactly the floor is satisfied — the reach-further query is the expensive
  // path and must not run for a category that already has enough.
  it('leaves a category sitting exactly on the floor alone', () => {
    const events = [...many('cinema', 40), ...many('music', MIN_EVENTS_PER_CATEGORY)];
    expect(categoriesBelowFloor(events, ['cinema', 'music'])).toEqual([]);
  });

  it('names several short categories at once', () => {
    expect(categoriesBelowFloor(many('cinema', 40), FEED_CATEGORIES)).toEqual([
      'theatre', 'exhibition', 'comedy', 'music',
    ]);
  });

  it('returns nothing when every wanted category is covered', () => {
    const events = FEED_CATEGORIES.flatMap((c) => many(c, MIN_EVENTS_PER_CATEGORY));
    expect(categoriesBelowFloor(events, FEED_CATEGORIES)).toEqual([]);
  });

  // An explicitly empty selection means "no categories", never "all of them" —
  // the same rule the store applies to an empty venueIds.
  it('treats an empty selection as asking for nothing', () => {
    expect(categoriesBelowFloor([], [])).toEqual([]);
  });

  it('ignores categories outside the wanted set', () => {
    const events = [...many('cinema', 40), ...many('other', 1)];
    expect(categoriesBelowFloor(events, ['cinema'])).toEqual([]);
  });

  it('honours an explicit floor', () => {
    const events = [...many('cinema', 40), ...many('music', 3)];
    expect(categoriesBelowFloor(events, ['music'], 3)).toEqual([]);
    expect(categoriesBelowFloor(events, ['music'], 4)).toEqual(['music']);
  });
});

describe('mergeUpcoming', () => {
  it('keeps one chronological listing', () => {
    const base = [ev('a', 'cinema', '2026-08-02T18:00:00Z')];
    const extra = [ev('b', 'theatre', '2026-08-01T18:00:00Z')];
    expect(mergeUpcoming(base, extra).map((e) => e.id)).toEqual(['b', 'a']);
  });

  // A top-up re-selects rows the base query already returned, so overlap is
  // the normal case, not an edge one.
  it('drops a row the top-up returned twice', () => {
    const shared = ev('a', 'theatre', '2026-08-02T18:00:00Z');
    expect(mergeUpcoming([shared], [shared])).toHaveLength(1);
  });

  it('is a no-op when there is nothing to add', () => {
    const base = many('cinema', 3);
    expect(mergeUpcoming(base, []).map((e) => e.id)).toEqual(base.map((e) => e.id));
  });

  it('carries every distinct row through', () => {
    const base = many('cinema', 3);
    const extra = many('theatre', 5, 10);
    expect(mergeUpcoming(base, extra)).toHaveLength(8);
  });
});

describe('the window', () => {
  // The ticket names both numbers; pin them so a later tweak is a deliberate
  // edit rather than a silent drift.
  it('reaches 90 days and floors at 5 per category', () => {
    expect(UPCOMING_WINDOW_DAYS).toBe(90);
    expect(MIN_EVENTS_PER_CATEGORY).toBe(5);
  });

  // 'other' is the unclassified bucket; reaching 90 days out for it would fill
  // the feed with exactly the rows least worth showing.
  it('does not reach further out for unclassified rows', () => {
    expect(FEED_CATEGORIES).not.toContain('other');
  });
});

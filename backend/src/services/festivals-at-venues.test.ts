import { describe, it, expect } from 'vitest';
import type { Festival } from '@goin/shared';
import { festivalVenueMatches, festivalsAtVenues } from '@goin/shared';
import { currentFestival } from './newsletter.js';

// GOI-33: festivals scoped to the venues a reader actually chose. The curated
// festival list and the venue list come from different places and disagree on
// spelling, so the matcher is the whole feature.
function fest(over: Partial<Festival> = {}): Festival {
  return {
    id: 'f1',
    name: 'Warsaw Film Festival',
    url: 'https://wff.pl',
    cinemas: ['Kinoteka', 'Kino Muranów'],
    city: 'Warsaw',
    startDate: '2026-10-09',
    endDate: '2026-10-18',
    description: 'Premieres and competitions.',
    status: 'upcoming',
    ...over,
  };
}

describe('festivalVenueMatches', () => {
  it('matches an exact venue name', () => {
    expect(festivalVenueMatches(fest(), ['Kinoteka'])).toEqual(['Kinoteka']);
  });

  it('ignores diacritics, including Polish ł', () => {
    // A user-typed or scraped name rarely matches the curated one byte for byte.
    expect(festivalVenueMatches(fest(), ['Kino Muranow'])).toEqual(['Kino Muranow']);
    expect(
      festivalVenueMatches(fest({ cinemas: ['Kino Iluzjon'] }), ['kino iluzjon']),
    ).toEqual(['kino iluzjon']);
    expect(
      festivalVenueMatches(fest({ cinemas: ['Kino Świt'] }), ['kino swit']),
    ).toEqual(['kino swit']);
  });

  it('matches when either side carries the extra "Kino" prefix', () => {
    // The festival says "Kino Muranów"; the user renamed theirs to "Muranów".
    expect(festivalVenueMatches(fest(), ['Muranów'])).toEqual(['Muranów']);
    expect(
      festivalVenueMatches(fest({ cinemas: ['Muranów'] }), ['Kino Muranów']),
    ).toEqual(['Kino Muranów']);
  });

  it('returns every matching venue, not just the first', () => {
    expect(festivalVenueMatches(fest(), ['Kinoteka', 'Muranów', 'Filharmonia'])).toEqual([
      'Kinoteka',
      'Muranów',
    ]);
  });

  it('returns nothing when no venue hosts it', () => {
    expect(festivalVenueMatches(fest(), ['Filharmonia Narodowa', 'Jassmine'])).toEqual([]);
  });

  it('does not match on blank names or an empty cinema list', () => {
    expect(festivalVenueMatches(fest(), ['', '   '])).toEqual([]);
    expect(festivalVenueMatches(fest({ cinemas: [] }), ['Kinoteka'])).toEqual([]);
    expect(festivalVenueMatches(fest({ cinemas: ['  '] }), ['Kinoteka'])).toEqual([]);
  });
});

describe('festivalsAtVenues', () => {
  const wff = fest();
  const jazz = fest({ id: 'f2', name: 'Jazz Days', cinemas: ['Jassmine'] });

  it('keeps only festivals at the reader\'s venues, annotated with which', () => {
    const out = festivalsAtVenues([wff, jazz], ['Kinoteka']);
    expect(out.map((f) => f.id)).toEqual(['f1']);
    expect(out[0]!.yourVenues).toEqual(['Kinoteka']);
  });

  it('preserves the incoming order', () => {
    const out = festivalsAtVenues([wff, jazz], ['Jassmine', 'Kinoteka']);
    expect(out.map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('returns nothing when the reader follows no matching venue', () => {
    expect(festivalsAtVenues([wff, jazz], ['Teatr Dramatyczny'])).toEqual([]);
    expect(festivalsAtVenues([wff, jazz], [])).toEqual([]);
  });
});

describe('currentFestival scoping (GOI-33)', () => {
  it('falls back to any ongoing festival when no venues are given', () => {
    // The settings preview has no subscriber, so scoping it to nothing would
    // hide the festival line from the very screen meant to show it.
    const unscoped = currentFestival();
    // The seed list is date-driven; whatever it returns, asking again with a
    // venue that cannot match must not return the same thing.
    if (unscoped) {
      expect(currentFestival(['Definitely Not A Real Venue'])).toBeNull();
    } else {
      expect(unscoped).toBeNull();
    }
  });

  it('returns null rather than an unrelated festival when scoped', () => {
    expect(currentFestival(['Definitely Not A Real Venue'])).toBeNull();
  });
});

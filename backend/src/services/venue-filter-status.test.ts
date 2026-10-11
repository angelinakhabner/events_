import { describe, it, expect } from 'vitest';
import { venueFilterStatus, venueStatusNote, venueSlug } from '@afisz/shared';

/**
 * Why a venue's count is what it is (GOI-76 §2). A zero meaning "nothing on
 * this Tuesday" and a zero meaning "we can't read this venue" look identical
 * on a chip, and only one of them is the user's problem to solve.
 */

const NOW = new Date('2026-08-16T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('venueFilterStatus', () => {
  it('is active when the venue has something upcoming', () => {
    expect(venueFilterStatus({ count: 3, upcomingTotal: 9, lastScrapedAt: daysAgo(1) }, NOW))
      .toBe('active');
  });

  // "Nothing on this Tuesday" is still an active venue.
  it('stays active when the period is empty but the programme is not', () => {
    expect(venueFilterStatus({ count: 0, upcomingTotal: 9, lastScrapedAt: daysAgo(1) }, NOW))
      .toBe('active');
  });

  it('is empty when nothing at all is upcoming', () => {
    expect(venueFilterStatus({ count: 0, upcomingTotal: 0, lastScrapedAt: daysAgo(1) }, NOW))
      .toBe('empty');
  });

  it('is stale once the venue has not been read for a week', () => {
    expect(venueFilterStatus({ count: 2, upcomingTotal: 2, lastScrapedAt: daysAgo(8) }, NOW))
      .toBe('stale');
    expect(venueFilterStatus({ count: 2, upcomingTotal: 2, lastScrapedAt: daysAgo(6) }, NOW))
      .toBe('active');
  });

  // A venue we cannot read is dark whatever its numbers say — every other
  // reading of them would be a guess.
  it('is dark when the last probe failed, outranking every other signal', () => {
    expect(venueFilterStatus(
      { count: 5, upcomingTotal: 5, probeErrorCode: 'BLOCKED', lastScrapedAt: daysAgo(1) },
      NOW,
    )).toBe('dark');
  });

  // "We read the page, there is nothing on" is not a reading failure.
  it('does not call a venue dark for a benign probe code', () => {
    expect(venueFilterStatus(
      { count: 0, upcomingTotal: 0, probeErrorCode: 'NO_EVENTS_FOUND', lastScrapedAt: daysAgo(1) },
      NOW,
    )).toBe('empty');
    expect(venueFilterStatus(
      { count: 0, upcomingTotal: 0, probeErrorCode: 'PAST_EVENTS_ONLY', lastScrapedAt: daysAgo(1) },
      NOW,
    )).toBe('empty');
  });

  it('handles a venue that has never been scraped', () => {
    expect(venueFilterStatus({ count: 0, upcomingTotal: 0, lastScrapedAt: null }, NOW))
      .toBe('empty');
  });
});

describe('venueStatusNote', () => {
  it('explains each non-obvious state, and says nothing when all is well', () => {
    expect(venueStatusNote('active', 4, null, NOW)).toBeNull();
    expect(venueStatusNote('active', 0, null, NOW)).toMatch(/nothing on in this period/i);
    expect(venueStatusNote('empty', 0, null, NOW)).toMatch(/no events listed/i);
    expect(venueStatusNote('dark', 0, null, NOW)).toMatch(/can.t currently read/i);
    expect(venueStatusNote('stale', 2, daysAgo(3), NOW)).toBe('Last updated 3 days ago');
  });

  it('reads correctly at one day, and without a date', () => {
    expect(venueStatusNote('stale', 1, daysAgo(1), NOW)).toBe('Last updated 1 day ago');
    expect(venueStatusNote('stale', 1, null, NOW)).toMatch(/a while ago/i);
  });
});

describe('venueSlug', () => {
  it('makes a URL-safe name', () => {
    expect(venueSlug('Kino Muranów')).toBe('kino-muranow');
    expect(venueSlug('Teatr Żydowski')).toBe('teatr-zydowski');
    expect(venueSlug('Kinoteka')).toBe('kinoteka');
  });

  it('handles ł, which has no combining form to strip', () => {
    expect(venueSlug('Królikarnia')).toBe('krolikarnia');
    expect(venueSlug('Łaźnia')).toBe('laznia');
  });

  it('collapses punctuation and trims the edges', () => {
    expect(venueSlug('  Klub “Komediowy” / Scena!  ')).toBe('klub-komediowy-scena');
  });
});

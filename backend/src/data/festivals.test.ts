import { describe, it, expect } from 'vitest';
import { FESTIVAL_SEEDS, listFestivals } from './festivals.js';

describe('festival seeds', () => {
  it('are well-formed: unique ids, valid inclusive date ranges, venues listed', () => {
    const ids = new Set(FESTIVAL_SEEDS.map((f) => f.id));
    expect(ids.size).toBe(FESTIVAL_SEEDS.length);
    for (const f of FESTIVAL_SEEDS) {
      expect(f.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.startDate <= f.endDate).toBe(true);
      expect(f.venues.length).toBeGreaterThan(0);
      expect(f.url).toMatch(/^https:\/\//);
    }
  });
});

describe('listFestivals', () => {
  it('drops past festivals, marks ongoing vs upcoming, sorts soonest first', () => {
    // Mid-July 2026: the summer open-air series is running, autumn ones ahead.
    const now = new Date('2026-07-23T12:00:00Z');
    const festivals = listFestivals(now);

    expect(festivals.length).toBeGreaterThan(0);
    const summer = festivals.find((f) => f.id === 'kino-letnie-2026');
    expect(summer?.status).toBe('ongoing');
    const wff = festivals.find((f) => f.id === 'wff-2026');
    expect(wff?.status).toBe('upcoming');

    const starts = festivals.map((f) => f.startDate);
    expect([...starts].sort()).toEqual(starts);
  });

  it('excludes festivals that already ended', () => {
    const now = new Date('2027-01-05T12:00:00Z');
    const festivals = listFestivals(now);
    expect(festivals.find((f) => f.id === 'wff-2026')).toBeUndefined();
  });

  /**
   * GOI-68: festivals belong to a listing, and every seed here is a film
   * festival. The ticket's point is that they must not turn up under Theatre.
   */
  it('files every seeded festival under cinema', () => {
    for (const f of FESTIVAL_SEEDS) expect(f.category).toBe('cinema');
  });

  it('narrows to one listing when asked', () => {
    const now = new Date('2026-07-23T12:00:00Z');
    const cinema = listFestivals(now, 'cinema');
    expect(cinema.length).toBeGreaterThan(0);
    expect(cinema.every((f) => f.category === 'cinema')).toBe(true);
  });

  it('returns nothing for a listing with no festivals of its own', () => {
    const now = new Date('2026-07-23T12:00:00Z');
    expect(listFestivals(now, 'theatre')).toEqual([]);
    expect(listFestivals(now, 'music')).toEqual([]);
  });

  // No category means the unfiltered home view, which shows all of them —
  // never "none".
  it('returns every listing when no category is given', () => {
    const now = new Date('2026-07-23T12:00:00Z');
    expect(listFestivals(now).length).toBe(listFestivals(now, 'cinema').length);
  });

  it('counts the festival last day as ongoing on the Warsaw calendar', () => {
    // 2026-10-18 21:59 UTC is still 2026-10-18 (23:59) in Warsaw — last night of WFF.
    const lastEvening = new Date('2026-10-18T21:59:00Z');
    const wff = listFestivals(lastEvening).find((f) => f.id === 'wff-2026');
    expect(wff?.status).toBe('ongoing');
  });
});

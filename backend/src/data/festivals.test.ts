import { describe, it, expect } from 'vitest';
import { FESTIVAL_SEEDS, listFestivals } from './festivals.js';

describe('festival seeds', () => {
  it('are well-formed: unique ids, valid inclusive date ranges, cinemas listed', () => {
    const ids = new Set(FESTIVAL_SEEDS.map((f) => f.id));
    expect(ids.size).toBe(FESTIVAL_SEEDS.length);
    for (const f of FESTIVAL_SEEDS) {
      expect(f.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.startDate <= f.endDate).toBe(true);
      expect(f.cinemas.length).toBeGreaterThan(0);
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

  it('counts the festival last day as ongoing on the Warsaw calendar', () => {
    // 2026-10-18 21:59 UTC is still 2026-10-18 (23:59) in Warsaw — last night of WFF.
    const lastEvening = new Date('2026-10-18T21:59:00Z');
    const wff = listFestivals(lastEvening).find((f) => f.id === 'wff-2026');
    expect(wff?.status).toBe('ongoing');
  });
});

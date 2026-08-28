import { describe, it, expect } from 'vitest';
import { bannerFestivals, FESTIVAL_BANNER_LEAD_DAYS, type Festival } from '@afisz/shared';
import { listFestivals } from './festivals.js';

/**
 * GOI-99: which festivals earn the top of the page.
 *
 * The window is the whole of the feature. A festival is worth interrupting the
 * listing for when it is on now or opens within a fortnight; before that it is
 * an advertisement standing between the reader and what's on tonight, and the
 * "Coming soon" block at the foot of the listing is the right place for it.
 */
function fest(over: Partial<Festival> = {}): Festival {
  return {
    id: 'f1',
    name: 'Festiwal Skrzyżowanie Kultur',
    url: 'https://skrzyzowaniekultur.pl',
    category: 'theatre',
    venues: ['Teatr Dramatyczny'],
    city: 'Warsaw',
    startDate: '2026-09-11',
    endDate: '2026-09-13',
    description: 'World music and stage work from across the map.',
    status: 'upcoming',
    imageUrl: null,
    ...over,
  };
}

const NOW = new Date('2026-09-01T10:00:00Z');

describe('bannerFestivals', () => {
  it('takes one opening inside the fortnight', () => {
    // 11 Sep is ten days after 1 Sep.
    expect(bannerFestivals([fest()], NOW).map((f) => f.id)).toEqual(['f1']);
  });

  it('leaves one that opens after it', () => {
    const later = fest({ id: 'wff', startDate: '2026-10-09', endDate: '2026-10-18' });
    expect(bannerFestivals([later], NOW)).toEqual([]);
  });

  it('takes one already running', () => {
    const running = fest({ id: 'now', startDate: '2026-08-20', endDate: '2026-09-05' });
    expect(bannerFestivals([running], NOW).map((f) => f.id)).toEqual(['now']);
  });

  it('drops one that has finished', () => {
    const over = fest({ id: 'past', startDate: '2026-08-01', endDate: '2026-08-30' });
    expect(bannerFestivals([over], NOW)).toEqual([]);
  });

  // The edges, since "no more than 2 weeks before" is the requirement itself
  // and an off-by-one here is a banner that appears a day early or late.
  describe('at the edge of the window', () => {
    it('includes one opening on the last day of the lead time', () => {
      const edge = fest({ startDate: '2026-09-15', endDate: '2026-09-20' });
      expect(FESTIVAL_BANNER_LEAD_DAYS).toBe(14);
      expect(bannerFestivals([edge], NOW)).toHaveLength(1);
    });

    it('excludes one opening the day after it', () => {
      const past = fest({ startDate: '2026-09-16', endDate: '2026-09-20' });
      expect(bannerFestivals([past], NOW)).toHaveLength(0);
    });

    // A festival's closing day is a day in Warsaw, not an instant in UTC. At
    // 23:30Z it is already tomorrow there, so the one that ends "today" in
    // Warsaw terms has gone.
    it('reads the calendar day in Warsaw', () => {
      const closing = fest({ startDate: '2026-09-01', endDate: '2026-09-01' });
      expect(bannerFestivals([closing], new Date('2026-09-01T12:00:00Z'))).toHaveLength(1);
      expect(bannerFestivals([closing], new Date('2026-09-01T23:30:00Z'))).toHaveLength(0);
    });
  });

  it('puts the soonest first', () => {
    const a = fest({ id: 'a', startDate: '2026-09-12', endDate: '2026-09-14' });
    const b = fest({ id: 'b', startDate: '2026-08-28', endDate: '2026-09-04' });
    expect(bannerFestivals([a, b], NOW).map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('is empty when nothing is near', () => {
    expect(bannerFestivals([], NOW)).toEqual([]);
  });
});

/** The banner and the "Coming soon" block partition one list between them —
 *  neither may swallow the other's festivals, and nothing may fall between. */
describe('the banner and the listing together', () => {
  it('split the curated list without overlap or loss', () => {
    const all = listFestivals(NOW);
    const banner = bannerFestivals(all, NOW).map((f) => f.id);
    const rest = all.filter((f) => !banner.includes(f.id)).map((f) => f.id);

    expect([...banner, ...rest].sort()).toEqual(all.map((f) => f.id).sort());
    expect(banner.filter((id) => rest.includes(id))).toEqual([]);
  });

  // GOI-99's own example: it arrives in Teatr Dramatyczny's repertoire as six
  // identically titled rows, which is the case the banner exists to explain.
  it('carries GOI-99\'s example in the fortnight before it opens', () => {
    const banner = bannerFestivals(listFestivals(NOW), NOW).map((f) => f.id);
    expect(banner).toContain('skrzyzowanie-kultur-2026');
  });

  it('leaves it in the listing a month out', () => {
    const early = new Date('2026-08-01T10:00:00Z');
    const banner = bannerFestivals(listFestivals(early), early).map((f) => f.id);
    expect(banner).not.toContain('skrzyzowanie-kultur-2026');
  });
});

/** The artwork is optional, and the API has to say so consistently — the
 *  banner switches on its presence, and `undefined` is not `null`. */
describe('festival artwork', () => {
  it('is always present as a field, null when there is none', () => {
    for (const f of listFestivals(NOW)) {
      expect(f).toHaveProperty('imageUrl');
      expect(f.imageUrl === null || typeof f.imageUrl === 'string').toBe(true);
    }
  });
});

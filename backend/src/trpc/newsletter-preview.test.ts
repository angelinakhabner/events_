import { describe, it, expect } from 'vitest';
import type { Event } from '@afisz/shared';
import { appRouter } from './router.js';
import type { AppContext } from './context.js';
import { InMemoryUserVenueStore } from '../services/user-venue-store.js';
import { InMemoryNewsletterStore } from '../services/newsletter-store.js';
import { briefFestivals } from '../services/newsletter.js';

/**
 * "Generate" (GOI-110 follow-up).
 *
 * The reader pressed Generate, looked at the PDF it handed back, and reported
 * that "want to go" was missing — and it was, from this route rather than from
 * the design: the preview built its brief without the saved-events queue, so
 * the block that sits above everything else in an issue was absent from the one
 * screen meant to show what an issue looks like. Tested here, at the route,
 * because both renderers already drew the block correctly when given one.
 */

const NOW_ISO = new Date(Date.now() + 20 * 3_600_000).toISOString();

const saved: Event = {
  id: 'e1',
  venueId: 'v1',
  title: 'Chungking Express',
  description: null,
  startsAt: NOW_ISO,
  endsAt: null,
  category: 'cinema',
  language: null,
  director: null,
  cast: [],
  durationMinutes: null,
  priceMin: null,
  priceMax: null,
  sourceUrl: 'https://example.com/film',
  sourceId: null,
  scrapedAt: new Date().toISOString(),
  venue: { id: 'v1', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
};

function ctx(events: Event[]): AppContext {
  return {
    user: { id: 'u1', email: 'a@b.pl' },
    userVenues: new InMemoryUserVenueStore(),
    newsletter: new InMemoryNewsletterStore(),
    wantToGo: { list: async () => events },
  } as unknown as AppContext;
}

const config = {
  email: 'a@b.pl',
  sendCadence: 'weekly' as const,
  sendWeekday: 1,
  venueIds: [],
  categoryRules: [
    {
      category: 'cinema', cadence: 'every_issue' as const, cadenceWeekday: null,
      detail: 'short' as const, timeFilter: 'any' as const, lookaheadDays: null, sortOrder: 0,
    },
  ],
};

describe('newsletter.preview', () => {
  it('carries the saved-events queue, not just the listings', async () => {
    const res = await appRouter.createCaller(ctx([saved])).my.newsletter.preview(config);

    expect(res.html).toContain('WANT TO GO');
    expect(res.html).toContain('Chungking Express');
    // Above the listings, which is the order GOI-110 sets out.
    expect(res.html.indexOf('WANT TO GO'))
      .toBeLessThan(res.html.indexOf('W tym tygodniu nic nie znaleźliśmy'));
  });

  it('carries the festival band, which the preview also went without', async () => {
    // Ongoing *or* opening soon: on the day this was reported nothing was
    // running, so a band that waited for opening night showed nothing at all.
    const res = await appRouter.createCaller(ctx([])).my.newsletter.preview(config);

    // Against the selector rather than a hardcoded name: the seed list is a
    // real calendar, so what is on depends on the day this test runs.
    const expected = briefFestivals(7);
    if (expected.length > 0) {
      expect(res.html).toContain('FESTIWALE');
      expect(res.html).toContain(expected[0]!.name);
    } else {
      expect(res.html).not.toContain('FESTIWALE');
    }
  });

  it('leaves the queue out when the reader turned saved events off', async () => {
    const res = await appRouter.createCaller(ctx([saved])).my.newsletter.preview({
      ...config,
      wantToGo: { enabled: false, horizonDays: 7, changesEnabled: true, urgentSend: true },
    });

    expect(res.html).not.toContain('Chungking Express');
  });

  it('has nothing to show when nothing is saved', async () => {
    const res = await appRouter.createCaller(ctx([])).my.newsletter.preview(config);

    expect(res.html).not.toContain('Chungking Express');
  });
});

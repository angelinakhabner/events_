import { describe, it, expect } from 'vitest';
import type { Event, NewsletterCategoryRule } from '@afisz/shared';
import type { BriefScope } from './newsletter.js';
import {
  briefWindowDays,
  briefFetchWindowDays,
  selectBriefEvents,
  isDue,
  dueSlot,
  resolveBriefVenues,
  sendNewsletterBriefs,
  buildBriefSections,
  eventInCategory,
  briefSubject,
  wasRecentlySent,
  fetchBriefEvents,
  ruleDueness,
} from './newsletter.js';
import { InMemoryUserVenueStore } from './user-venue-store.js';
import type { EventListInput } from './event-store.js';
import { InMemoryNewsletterStore } from './newsletter-store.js';
import type { NewsletterSubscription } from './newsletter-store.js';

// A Wednesday noon in Warsaw (CEST = UTC+2).
const NOW = new Date('2026-07-22T10:00:00Z');

function makeEvent(over: Partial<Event>): Event {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    venueId: 'v1',
    title: 'Some Film',
    description: null,
    startsAt: '2026-07-22T18:00:00+02:00',
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
    scrapedAt: NOW.toISOString(),
    venue: { id: 'v1', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
    ...over,
  };
}

function makeSub(over: Partial<NewsletterSubscription> = {}): NewsletterSubscription {
  return {
    userId: 'u1',
    id: 'cfg-1',
    folderId: null,
    name: 'Newsletter',
    email: 'user@example.com',
    recipientName: null,
    delivery: 'email',
    sendCadence: 'daily',
    venueIds: [],
    beforeHour: null,
    sendHour: 8,
    sendMinute: 0,
    sendWeekday: null,
    sendDayOfMonth: null,
    timezone: 'Europe/Warsaw',
    suppressEmptyIssues: true,
    wantToGo: { enabled: true, horizonDays: 7, changesEnabled: true, urgentSend: true },
    categoryRules: [],
    enabled: true,
    lastSentAt: null,
    ...over,
  };
}

/** A rule with the fields a caller isn't asserting on filled in. */
function makeRule(over: Partial<NewsletterCategoryRule> & { category: string }): NewsletterCategoryRule {
  return {
    cadence: 'every_issue',
    cadenceWeekday: null,
    detail: 'short',
    timeFilter: 'any',
    lookaheadDays: null,
    sortOrder: 0,
    ...over,
  };
}

/** What `selectBriefEvents` takes since GOI-100: a span in days rather than a
 *  cadence, because a section's window is derived from two cadences at once. */
function scope(over: Partial<BriefScope> = {}): BriefScope {
  return { windowDays: 1, venueIds: [], ...over };
}

describe('briefFetchWindowDays', () => {
  it('is the send cadence when there are no rules', () => {
    expect(briefFetchWindowDays(makeSub({ sendCadence: 'weekly' }), NOW)).toBe(7);
  });

  it('never comes out narrower than the issue carrying it', () => {
    // A monthly section in a weekly newsletter covers 28 days; the floor only
    // has to make sure a *narrower* set of rules can't shrink the fetch.
    const sub = makeSub({
      sendCadence: 'weekly',
      categoryRules: [makeRule({ category: 'cinema', cadence: 'every_issue' })],
    });
    expect(briefFetchWindowDays(sub, NOW)).toBe(7);
  });

  it('reaches as far as the widest lookahead override, past a month', () => {
    // The bug this replaced: the fetch was derived from a *cadence*, which
    // tops out at 30 days, so a 60-day section was built from 30 days of
    // events and lost the rest without saying so.
    const sub = makeSub({
      sendCadence: 'weekly',
      categoryRules: [
        makeRule({ category: 'cinema' }),
        makeRule({ category: 'theatre', cadence: 'monthly', lookaheadDays: 60, sortOrder: 1 }),
      ],
    });
    expect(briefFetchWindowDays(sub, NOW)).toBe(60);
  });
});

describe('briefWindowDays', () => {
  it('is a day, a week or a month', () => {
    expect(briefWindowDays('daily')).toBe(1);
    expect(briefWindowDays('weekly')).toBe(7);
    expect(briefWindowDays('monthly')).toBe(30);
  });
});

// A category is whichever the reader picked — a built-in event category or
// one of their own venue tags — so both have to match.
describe('eventInCategory', () => {
  const tags = new Map([['v1', ['Arthouse', 'date night']]]);

  it('matches a built-in event category', () => {
    expect(eventInCategory(makeEvent({ category: 'cinema' }), 'cinema', tags)).toBe(true);
    expect(eventInCategory(makeEvent({ category: 'cinema' }), 'comedy', tags)).toBe(false);
  });

  it('matches a venue tag, case-insensitively', () => {
    expect(eventInCategory(makeEvent({ venueId: 'v1' }), 'arthouse', tags)).toBe(true);
    expect(eventInCategory(makeEvent({ venueId: 'v1' }), 'DATE NIGHT', tags)).toBe(true);
    expect(eventInCategory(makeEvent({ venueId: 'v2' }), 'arthouse', tags)).toBe(false);
  });

  it('never matches on an empty category', () => {
    expect(eventInCategory(makeEvent({}), '  ', tags)).toBe(false);
  });
});

describe('briefSubject', () => {
  const s = (windowDays: number) =>
    ({ category: 'x', windowDays, detail: 'short' as const, events: [] });

  it('reads to the widest window in the email', () => {
    expect(briefSubject([s(1)])).toMatch(/today/i);
    expect(briefSubject([s(1), s(7)])).toMatch(/week/i);
    expect(briefSubject([s(1), s(30)])).toMatch(/month/i);
  });
});

describe('selectBriefEvents', () => {
  it('keeps only events inside the cadence window', () => {
    const today = makeEvent({ id: 'today', startsAt: '2026-07-22T20:00:00+02:00' });
    const nextWeek = makeEvent({ id: 'next-week', startsAt: '2026-07-27T20:00:00+02:00' });
    const past = makeEvent({ id: 'past', startsAt: '2026-07-21T20:00:00+02:00' });

    const daily = selectBriefEvents([today, nextWeek, past], scope({ windowDays: 1 }), NOW);
    expect(daily.map((e) => e.id)).toEqual(['today']);

    const weekly = selectBriefEvents([today, nextWeek, past], scope({ windowDays: 7 }), NOW);
    expect(weekly.map((e) => e.id)).toEqual(['today', 'next-week']);
  });

  it('scopes to the chosen venues; empty selection means all', () => {
    const a = makeEvent({ id: 'a', venueId: 'v1' });
    const b = makeEvent({ id: 'b', venueId: 'v2' });

    expect(selectBriefEvents([a, b], scope({ venueIds: ['v2'] }), NOW).map((e) => e.id)).toEqual(['b']);
    expect(selectBriefEvents([a, b], scope({ venueIds: [] }), NOW)).toHaveLength(2);
  });

  it('applies the after-hour filter on the Warsaw clock ("after 6 pm")', () => {
    const matinee = makeEvent({ id: 'matinee', startsAt: '2026-07-22T15:00:00+02:00' });
    const evening = makeEvent({ id: 'evening', startsAt: '2026-07-22T18:30:00+02:00' });

    const picked = selectBriefEvents([matinee, evening], scope({ afterHour: 18 }), NOW);
    expect(picked.map((e) => e.id)).toEqual(['evening']);
  });

  /**
   * A museum show is a run, not an occurrence (GOI-67), and this selection was
   * the last place in the pipeline that did not know it (GOI-106).
   *
   * `startsAt` for a run is the opening date, usually months past, so
   * `starts < now` threw out every exhibition that was actually on — in every
   * issue, of every newsletter, whatever the window. The store fetches them
   * (`listUpcoming` selects a run by its closing date); this dropped them
   * again, the museums section came out empty, `buildBriefSections` dropped
   * it, and the brief was cinema — whose screenings have future starts.
   */
  describe('exhibitions, which are runs rather than occurrences', () => {
    const running = makeEvent({
      id: 'formy',
      kind: 'exhibition',
      category: 'exhibition',
      // Opened in June, closes in October: on today, by three months past.
      startsAt: '2026-06-01T00:00:00+02:00',
      endsAt: '2026-10-24T00:00:00+02:00',
    });

    it('keeps a run that is on now, whatever its opening date', () => {
      const picked = selectBriefEvents([running], scope({ windowDays: 1 }), NOW);
      expect(picked.map((e) => e.id)).toEqual(['formy']);
    });

    it('keeps it in a one-day window as readily as a thirty-day one', () => {
      for (const windowDays of [1, 7, 30]) {
        expect(selectBriefEvents([running], scope({ windowDays }), NOW)).toHaveLength(1);
      }
    });

    it('drops a run that has already closed', () => {
      const closed = makeEvent({
        ...running, id: 'closed', endsAt: '2026-07-01T00:00:00+02:00',
      });
      expect(selectBriefEvents([closed], scope({ windowDays: 30 }), NOW)).toEqual([]);
    });

    it('leaves a run that opens after this issue to a later one', () => {
      const later = makeEvent({
        ...running, id: 'later',
        startsAt: '2026-09-01T00:00:00+02:00',
        endsAt: '2026-12-01T00:00:00+02:00',
      });
      expect(selectBriefEvents([later], scope({ windowDays: 1 }), NOW)).toEqual([]);
      expect(selectBriefEvents([later], scope({ windowDays: 60 }), NOW)).toHaveLength(1);
    });

    /**
     * Same rule as the feed's (`filters.ts`): a run is on all day, every day,
     * so it has no schedule to answer a time-of-day question with — and its
     * `startsAt` is a midnight placeholder, which would answer "before 10:00"
     * yes by accident. The `TIME` column's default is "any time", which is
     * what a museums row sensibly carries.
     */
    it('is not among the answers when the row asks a time-of-day question', () => {
      expect(selectBriefEvents([running], scope({ windowDays: 30 }), NOW)).toHaveLength(1);
      expect(selectBriefEvents([running], scope({ windowDays: 30, afterHour: 18 }), NOW)).toEqual([]);
      expect(selectBriefEvents([running], scope({ windowDays: 30, beforeHour: 10 }), NOW)).toEqual([]);
    });

    it('treats a run with no closing date as a timed event, which is all it can', () => {
      const openEnded = makeEvent({
        ...running, id: 'open-ended', endsAt: null,
        startsAt: '2026-06-01T00:00:00+02:00',
      });
      expect(selectBriefEvents([openEnded], scope({ windowDays: 30 }), NOW)).toEqual([]);
    });

    it('still scopes a run to the chosen venues', () => {
      const elsewhere = makeEvent({ ...running, id: 'elsewhere', venueId: 'v9' });
      expect(selectBriefEvents([elsewhere], scope({ windowDays: 30, venueIds: ['v1'] }), NOW)).toEqual([]);
    });
  });

  it('applies the before-hour filter', () => {
    const matinee = makeEvent({ id: 'matinee', startsAt: '2026-07-22T15:00:00+02:00' });
    const evening = makeEvent({ id: 'evening', startsAt: '2026-07-22T20:00:00+02:00' });

    const picked = selectBriefEvents([matinee, evening], scope({ beforeHour: 18 }), NOW);
    expect(picked.map((e) => e.id)).toEqual(['matinee']);
  });

});

// The heart of per-category briefs: which sections turn up today, what each
// one covers, and how much it says.
describe('buildBriefSections', () => {
  const VENUES = [
    { id: 'v1', tags: ['arthouse'] },
    { id: 'v2', tags: [] },
  ] as Parameters<typeof buildBriefSections>[2];

  /** A cinema tonight, a comedy night tonight, and a cinema next week. */
  function week() {
    return [
      makeEvent({ id: 'film-today', category: 'cinema', startsAt: '2026-07-22T20:00:00+02:00' }),
      makeEvent({ id: 'comedy-today', category: 'comedy', venueId: 'v2', startsAt: '2026-07-22T21:00:00+02:00' }),
      makeEvent({ id: 'film-next-week', category: 'cinema', startsAt: '2026-07-27T20:00:00+02:00' }),
    ];
  }

  it('with no rules, returns one unnamed section on the subscription cadence', () => {
    const sections = buildBriefSections(week(), makeSub({ sendCadence: 'daily' }), VENUES, NOW);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.category).toBe('');
    expect(sections[0]!.events.map((e) => e.id).sort()).toEqual(['comedy-today', 'film-today']);
  });

  it('gives each category its own window, so a weekly section reaches further', () => {
    const sections = buildBriefSections(
      week(),
      makeSub({
        categoryRules: [
          makeRule({ category: 'cinema', cadence: 'weekly', cadenceWeekday: 3, detail: 'short' }),
          makeRule({ category: 'comedy', cadence: 'every_issue', detail: 'full' }),
        ],
        sendWeekday: 3, // Wednesday — the weekly rule is due today
      }),
      VENUES,
      NOW,
    );

    expect(sections.map((s) => s.category)).toEqual(['cinema', 'comedy']);
    // The weekly cinema section reaches into next week; comedy stays on today.
    expect(sections[0]!.events.map((e) => e.id)).toEqual(['film-today', 'film-next-week']);
    expect(sections[1]!.events.map((e) => e.id)).toEqual(['comedy-today']);
    expect(sections[1]!.detail).toBe('full');
  });

  it('leaves out a section whose cadence is not due today', () => {
    // Monthly is due on the 1st; NOW is the 22nd.
    const sections = buildBriefSections(
      week(),
      makeSub({
        categoryRules: [
          makeRule({ category: 'cinema', cadence: 'every_issue', detail: 'short' }),
          makeRule({ category: 'comedy', cadence: 'monthly', detail: 'full' }),
        ],
      }),
      VENUES,
      NOW,
    );
    expect(sections.map((s) => s.category)).toEqual(['cinema']);
  });

  it('brings the monthly section in on the 1st, alongside the daily one', () => {
    const firstOfMonth = new Date('2026-08-01T10:00:00Z');
    const events = [
      makeEvent({ id: 'film', category: 'cinema', startsAt: '2026-08-01T20:00:00+02:00' }),
      makeEvent({ id: 'show', category: 'comedy', venueId: 'v2', startsAt: '2026-08-20T20:00:00+02:00' }),
    ];
    const sections = buildBriefSections(
      events,
      makeSub({
        categoryRules: [
          makeRule({ category: 'cinema', cadence: 'every_issue', detail: 'short' }),
          makeRule({ category: 'comedy', cadence: 'monthly', detail: 'full' }),
        ],
      }),
      VENUES,
      firstOfMonth,
    );
    expect(sections.map((s) => s.category)).toEqual(['cinema', 'comedy']);
    // The monthly window reaches the event three weeks out; a daily one would not.
    expect(sections[1]!.events.map((e) => e.id)).toEqual(['show']);
  });

  it('matches a rule naming one of the reader\'s venue tags', () => {
    const sections = buildBriefSections(
      week(),
      makeSub({ categoryRules: [makeRule({ category: 'arthouse', cadence: 'every_issue', detail: 'short' })] }),
      VENUES,
      NOW,
    );
    // v1 carries the tag; the comedy night at v2 does not.
    expect(sections[0]!.events.map((e) => e.id)).toEqual(['film-today']);
  });

  it('never lists one event twice when two due rules would both catch it', () => {
    const sections = buildBriefSections(
      week(),
      makeSub({
        categoryRules: [
          makeRule({ category: 'cinema', cadence: 'every_issue', detail: 'short' }),
          makeRule({ category: 'arthouse', cadence: 'every_issue', detail: 'full' }),
        ],
      }),
      VENUES,
      NOW,
    );
    const ids = sections.flatMap((s) => s.events.map((e) => e.id));
    expect(ids).toEqual([...new Set(ids)]);
    expect(sections.map((s) => s.category)).toEqual(['cinema']); // arthouse had nothing left
  });

  it('drops a rule that caught nothing rather than showing an empty section', () => {
    const sections = buildBriefSections(
      week(),
      makeSub({ categoryRules: [makeRule({ category: 'opera', cadence: 'every_issue', detail: 'short' })] }),
      VENUES,
      NOW,
    );
    expect(sections).toEqual([]);
  });
});

describe('resolveBriefVenues', () => {
  it('expands an empty selection to the user\'s own venues, not every venue', async () => {
    const venues = new InMemoryUserVenueStore();
    await venues.ensureSeeded('u1');
    const mine = (await venues.listAll('u1')).map((v) => v.id);

    expect(mine.length).toBeGreaterThan(0);
    expect((await resolveBriefVenues('u1', [], venues)).map((v) => v.id)).toEqual(mine);
    // A user who follows nothing resolves to nothing — the sweep skips them
    // rather than mailing them the whole database.
    expect(await resolveBriefVenues('nobody', [], new InMemoryUserVenueStore([]))).toEqual([]);
  });

  it('keeps an explicit selection, and carries each venue\'s tags for rules', async () => {
    const venues = new InMemoryUserVenueStore([]);
    const cinema = await venues.addCustom('u1', {
      name: 'Kinoteka', url: 'https://kinoteka.example/', category: 'cinema',
      city: 'Warsaw', country: 'PL',
    });
    await venues.addCustom('u1', {
      name: 'Klub Komediowy', url: 'https://komediowy.example/', category: 'comedy',
      city: 'Warsaw', country: 'PL',
    });
    await venues.update('u1', cinema.id, { tags: ['arthouse'] });

    const picked = await resolveBriefVenues('u1', [cinema.id], venues);
    expect(picked.map((v) => v.id)).toEqual([cinema.id]);
    expect(picked[0]!.tags).toEqual(['arthouse']);
  });
});

describe('wasRecentlySent', () => {
  it('skips a repeat inside the same hour but not the next scheduled send', () => {
    // The tick is hourly and isSendHour gates it to one hour a day, so only a
    // re-run within that hour is a duplicate.
    expect(wasRecentlySent({ lastSentAt: '2026-07-22T09:40:00Z' }, NOW)).toBe(true);
    expect(wasRecentlySent({ lastSentAt: '2026-07-22T09:00:00Z' }, NOW)).toBe(false);
    expect(wasRecentlySent({ lastSentAt: '2026-07-21T06:00:00Z' }, NOW)).toBe(false);
  });

  it('never skips a sub that was never sent', () => {
    expect(wasRecentlySent({ lastSentAt: null }, NOW)).toBe(false);
  });
});

describe('dueSlot', () => {
  it('is the most recent send hour on the Warsaw wall clock', () => {
    // NOW is Wed 12:00 Warsaw; 08:00 Warsaw that day is 06:00 UTC.
    expect(dueSlot(makeSub({ sendHour: 8 }), NOW)?.toISOString()).toBe('2026-07-22T06:00:00.000Z');
  });

  it('reaches back to yesterday when today\'s hour has not arrived yet', () => {
    expect(dueSlot(makeSub({ sendHour: 20 }), NOW)?.toISOString()).toBe('2026-07-21T18:00:00.000Z');
  });

  it('for weekly subs lands on the chosen weekday', () => {
    // Weekly Monday brief, asked for on a Wednesday → last Monday 08:00 Warsaw.
    const sub = makeSub({ sendCadence: 'weekly', sendWeekday: 1, sendHour: 8 });
    expect(dueSlot(sub, NOW)?.toISOString()).toBe('2026-07-20T06:00:00.000Z');
  });

  it('carries the chosen minute', () => {
    // 08:37 Warsaw is 06:37 UTC under CEST.
    expect(dueSlot(makeSub({ sendHour: 8, sendMinute: 37 }), NOW)?.toISOString())
      .toBe('2026-07-22T06:37:00.000Z');
  });

  it('falls back a day when the minute has not arrived yet', () => {
    // NOW is 12:00 Warsaw exactly; a 12:30 slot is still ahead of it today.
    expect(dueSlot(makeSub({ sendHour: 12, sendMinute: 30 }), NOW)?.toISOString())
      .toBe('2026-07-21T10:30:00.000Z');
  });
});

describe('isDue', () => {
  it('is due at the send hour when nothing has been sent yet', () => {
    expect(isDue(makeSub({ sendHour: 8, lastSentAt: null }), new Date('2026-07-22T06:00:00Z'))).toBe(true);
  });

  it('is not due before the first slot of the day arrives', () => {
    // 05:00 UTC = 07:00 Warsaw, an hour before the 08:00 slot. Yesterday's slot
    // is well outside the catch-up window.
    expect(isDue(makeSub({ sendHour: 8, lastSentAt: null }), new Date('2026-07-22T05:00:00Z'))).toBe(false);
  });

  it('catches up a slot missed by a restart, within the grace window', () => {
    // Two hours after the 08:00 Warsaw slot, nothing sent for it yet: the old
    // exact-hour check dropped this brief for the whole day.
    expect(isDue(makeSub({ sendHour: 8, lastSentAt: null }), new Date('2026-07-22T08:00:00Z'))).toBe(true);
  });

  it('gives up on a slot older than the catch-up window', () => {
    const lateAfternoon = new Date('2026-07-22T13:00:00Z'); // 15:00 Warsaw, 7h late
    expect(isDue(makeSub({ sendHour: 8, lastSentAt: null }), lateAfternoon)).toBe(false);
  });

  it('does not re-send a slot already sent', () => {
    const sub = makeSub({ sendHour: 8, lastSentAt: '2026-07-22T06:00:00Z' });
    expect(isDue(sub, new Date('2026-07-22T07:00:00Z'))).toBe(false);
  });

  it('respects the minute, not just the hour', () => {
    const sub = makeSub({ sendHour: 8, sendMinute: 30, lastSentAt: null });
    // 08:29 Warsaw — the hour matches but the slot hasn't arrived, and
    // yesterday's is long past the catch-up window.
    expect(isDue(sub, new Date('2026-07-22T06:29:00Z'))).toBe(false);
    expect(isDue(sub, new Date('2026-07-22T06:30:00Z'))).toBe(true);
  });

  it('is due again once the next day\'s slot comes round', () => {
    const sub = makeSub({ sendHour: 8, lastSentAt: '2026-07-22T06:00:00Z' });
    expect(isDue(sub, new Date('2026-07-23T06:00:00Z'))).toBe(true);
  });

  it('holds a weekly brief until its weekday', () => {
    const sub = makeSub({ sendCadence: 'weekly', sendWeekday: 1, sendHour: 8, lastSentAt: '2026-07-20T06:00:00Z' });
    expect(isDue(sub, new Date('2026-07-22T06:00:00Z'))).toBe(false); // Wednesday
    expect(isDue(sub, new Date('2026-07-27T06:00:00Z'))).toBe(true); // next Monday
  });
});

describe('sendNewsletterBriefs', () => {
  async function storeWith(over: Parameters<InMemoryNewsletterStore['save']>[1]) {
    const store = new InMemoryNewsletterStore();
    await store.save('u1', over);
    return store;
  }

  /** Venue and event sources for the sweep. Injected rather than left to the
   *  module defaults, which follow DATABASE_URL — under CI that means real SQL,
   *  and these fixtures' user ids aren't UUIDs. Empty by default: a subscriber
   *  who follows nothing is the 'no-venues' case. */
  function deps(venues = new InMemoryUserVenueStore([])) {
    return { venues, events: { listUpcoming: async () => [] } };
  }

  /** A venue store where u1 follows v1 and v2 — `resolveBriefVenues` filters
   *  the subscription's selection against what the user actually follows, so
   *  the ids have to exist on both sides. */
  async function venuesFollowedByU1() {
    const venue = (id: string, name: string) => ({
      id, name, url: `https://example.com/${id}`, city: 'Warsaw', country: 'PL',
      category: 'cinema' as const, language: 'pl', timezone: 'Europe/Warsaw',
      createdAt: NOW.toISOString(),
    });
    const store = new InMemoryUserVenueStore([venue('v1', 'Kinoteka'), venue('v2', 'Muranów')]);
    await store.ensureSeeded('u1');
    return store;
  }

  it('reports why nothing was sent instead of skipping silently', async () => {
    const store = await storeWith({
      email: 'a@b.pl', sendCadence: 'daily', venueIds: [], sendHour: 8, enabled: true,
    });
    // 03:00 Warsaw — no slot in the catch-up window.
    const res = await sendNewsletterBriefs(store, new Date('2026-07-22T01:00:00Z'), { ...deps(), dryRun: true });

    expect(res.sent).toBe(0);
    expect(res.outcomes).toHaveLength(1);
    expect(res.outcomes[0]).toMatchObject({ email: 'a@b.pl', status: 'skipped', reason: 'not-due' });
  });

  it('force ignores the schedule but still needs venues', async () => {
    const store = await storeWith({
      email: 'a@b.pl', sendCadence: 'daily', venueIds: [], sendHour: 8, enabled: true,
    });
    // 03:00 Warsaw — nowhere near the 08:00 slot, so this would be 'not-due'
    // without force. Past that gate it reports the real obstacle: an empty
    // selection resolves to the user's own venues, and this user follows none.
    const res = await sendNewsletterBriefs(store, new Date('2026-07-22T01:00:00Z'), {
      ...deps(), dryRun: true, force: true,
    });

    expect(res.outcomes[0]).toMatchObject({ status: 'skipped', reason: 'no-venues' });
  });

  it('narrows the event query to the brief\'s venues and window', async () => {
    // The row limit cuts the globally earliest events, so asking for "the next
    // 500" and filtering by venue afterwards drops the later days of a weekly
    // brief once the database holds more than that. The venues and the window
    // have to reach SQL.
    const store = await storeWith({
      email: 'a@b.pl', sendCadence: 'weekly', venueIds: ['v1', 'v2'], sendHour: 8, sendWeekday: 1, enabled: true,
    });
    const queries: EventListInput[] = [];
    await sendNewsletterBriefs(store, NOW, {
      ...deps(await venuesFollowedByU1()),
      events: { listUpcoming: async (q = {}) => { queries.push(q); return []; } },
      dryRun: true,
      force: true,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.venueIds).toEqual(['v1', 'v2']);
    expect(queries[0]!.now).toEqual(NOW);
    // Weekly → seven days ahead.
    expect(queries[0]!.until?.getTime()).toBe(NOW.getTime() + 7 * 24 * 3_600_000);
  });

  it('fetches as far ahead as the section reaches, not as far as the cadence', async () => {
    // A 60-day lookahead on a weekly newsletter: the query has to cover the
    // section, or the section is silently truncated at the cadence's 7 days
    // while still claiming the wider window in the subject line and the PDF.
    const store = await storeWith({
      email: 'a@b.pl',
      sendCadence: 'weekly',
      venueIds: ['v1', 'v2'],
      sendHour: 8,
      sendWeekday: 1,
      enabled: true,
      categoryRules: [
        { category: 'cinema', cadence: 'every_issue', cadenceWeekday: null, detail: 'short', timeFilter: 'any', lookaheadDays: 60, sortOrder: 0 },
      ],
    });
    const queries: EventListInput[] = [];
    await sendNewsletterBriefs(store, NOW, {
      ...deps(await venuesFollowedByU1()),
      events: { listUpcoming: async (q = {}) => { queries.push(q); return []; } },
      dryRun: true,
      force: true,
    });

    expect(queries[0]!.until?.getTime()).toBe(NOW.getTime() + 60 * 24 * 3_600_000);
  });

  /**
   * A section that is not in this issue is not fetched for either (GOI-106).
   *
   * The fetch is per due section now, so "which rows does this issue need" and
   * "which sections does this issue carry" are one question rather than two
   * that can disagree. NOW is the 22nd, and a monthly rule in a weekly
   * newsletter rides the month's first issue.
   */
  it('does not query for a section that is not due in this issue', async () => {
    const store = await storeWith({
      email: 'a@b.pl',
      sendCadence: 'weekly',
      venueIds: ['v1', 'v2'],
      sendHour: 8,
      sendWeekday: 1,
      enabled: true,
      categoryRules: [
        { category: 'cinema', cadence: 'monthly', cadenceWeekday: null, detail: 'short', timeFilter: 'any', lookaheadDays: 60, sortOrder: 0 },
      ],
    });
    const queries: EventListInput[] = [];
    await sendNewsletterBriefs(store, NOW, {
      ...deps(await venuesFollowedByU1()),
      events: { listUpcoming: async (q = {}) => { queries.push(q); return []; } },
      dryRun: true,
      force: true,
    });

    expect(queries).toEqual([]);
  });

  it('only restricts the sweep to one subscriber', async () => {
    const store = new InMemoryNewsletterStore();
    await store.save('u1', { email: 'a@b.pl', sendCadence: 'daily', venueIds: [], enabled: true });
    await store.save('u2', { email: 'c@d.pl', sendCadence: 'daily', venueIds: [], enabled: true });

    const res = await sendNewsletterBriefs(store, NOW, { ...deps(), dryRun: true, only: 'c@d.pl' });
    expect(res.outcomes.map((o) => o.email)).toEqual(['c@d.pl']);
  });
});

describe('InMemoryNewsletterStore', () => {
  it('saves and reads back settings, preserving lastSentAt across saves', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await store.save('u1', {
      email: 'a@b.pl',
      sendCadence: 'daily',
      venueIds: ['v1'],
      enabled: true,
    });
    // Addressed by config id since GOI-100 — a reader may hold one per folder.
    await store.markSent(saved.id, new Date('2026-07-22T06:00:00Z'));
    const updated = await store.save('u1', {
      email: 'a@b.pl',
      sendCadence: 'weekly',
      sendWeekday: 1,
      venueIds: ['v1', 'v2'],
      enabled: true,
    });

    expect(updated.sendCadence).toBe('weekly');
    expect(updated.lastSentAt).toBe('2026-07-22T06:00:00.000Z');
  });

  it('listEnabled returns only enabled subscriptions', async () => {
    const store = new InMemoryNewsletterStore();
    await store.save('on', { email: 'on@x.pl', sendCadence: 'daily', venueIds: [], enabled: true });
    await store.save('off', { email: 'off@x.pl', sendCadence: 'daily', venueIds: [], enabled: false });

    const subs = await store.listEnabled();
    expect(subs.map((s) => s.userId)).toEqual(['on']);
  });
});

/**
 * The reported bug (GOI-106): a brief configured for cinema, museums and
 * theatre arrived as cinema only.
 *
 * The fetch was one query — the 500 globally-earliest rows across every
 * followed venue, over the *widest* window any section asked for. That is the
 * failure `listUpcomingWithCategoryFloor` already documents for the feed, in a
 * place that never got the fix: three cinemas publishing twenty screenings a
 * day fill 500 rows inside a month, so a monthly museums section reaching 30
 * days ahead was built from events that were never fetched. It came out empty,
 * `buildBriefSections` dropped it, and the reader got a cinema-only PDF with
 * nothing anywhere admitting a section had been configured.
 */
describe('fetchBriefEvents (GOI-106)', () => {
  const VENUES = [
    { id: 'kino', name: 'Kinoteka', category: 'cinema', tags: ['arthouse'] },
    { id: 'msn', name: 'MSN', category: 'exhibition', tags: [] },
    { id: 'teatr', name: 'Teatr Polski', category: 'theatre', tags: [] },
  ] as unknown as Parameters<typeof fetchBriefEvents>[1];

  /**
   * A store that answers each query honestly, including its 500-row cap and
   * its earliest-first ordering — which is what makes the starvation real
   * rather than theoretical.
   */
  function storeOver(catalogue: Event[]) {
    const queries: EventListInput[] = [];
    const listUpcoming = async (q: EventListInput = {}) => {
      const until = q.until;
      const rows = catalogue
        .filter((e) => new Date(e.startsAt) >= (q.now ?? NOW))
        .filter((e) => (until ? new Date(e.startsAt) <= until : true))
        .filter((e) => (q.venueIds ? q.venueIds.includes(e.venueId) : true))
        .filter((e) => (q.categories ? q.categories.includes(e.category) : true))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      return rows.slice(0, Math.min(q.limit ?? 100, 500));
    };
    return {
      queries,
      store: { listUpcoming: async (q: EventListInput = {}) => { queries.push(q); return listUpcoming(q); } },
    };
  }

  /**
   * Warsaw as this reader follows it: three cinemas between them publishing
   * twenty screenings a day, and a museum and a theatre whose next dates are
   * four weeks out — which is exactly where 500 cinema rows stop.
   */
  const CATALOGUE: Event[] = [];
  for (let day = 0; day < 40; day += 1) {
    const at = (hour: number) =>
      new Date(NOW.getTime() + day * 86_400_000 + hour * 3_600_000).toISOString();
    for (let n = 0; n < 20; n += 1) {
      CATALOGUE.push(makeEvent({
        id: `kino-${day}-${n}`, venueId: 'kino', category: 'cinema', startsAt: at(6 + n * 0.5),
      }));
    }
    if (day >= 27) {
      CATALOGUE.push(makeEvent({ id: `msn-${day}`, venueId: 'msn', category: 'exhibition', startsAt: at(11) }));
      CATALOGUE.push(makeEvent({ id: `teatr-${day}`, venueId: 'teatr', category: 'theatre', startsAt: at(19) }));
    }
  }

  /** The reported configuration: a daily newsletter, cinema every issue, and
   *  museums and theatre looking a month ahead. */
  const REPORTED = makeSub({
    sendCadence: 'daily',
    categoryRules: [
      makeRule({ category: 'cinema', sortOrder: 0 }),
      makeRule({ category: 'exhibition', lookaheadDays: 30, sortOrder: 1 }),
      makeRule({ category: 'theatre', lookaheadDays: 30, sortOrder: 2 }),
    ],
  });

  it('reaches sections the densest category would otherwise truncate away', async () => {
    const { store } = storeOver(CATALOGUE);
    const events = await fetchBriefEvents(REPORTED, VENUES, store, NOW);
    const sections = buildBriefSections(events, REPORTED, VENUES, NOW);

    expect(sections.map((s) => s.category)).toEqual(['cinema', 'exhibition', 'theatre']);
    for (const section of sections) expect(section.events.length).toBeGreaterThan(0);
  });

  /**
   * The same settings through the one shared query this replaced — so the
   * test above is passing because of the fix, not because the fixture is
   * generous. 500 rows of a twenty-a-day cinema stop around day 25; the
   * museum and theatre dates are past that, so both sections vanish and the
   * brief is cinema only. Which is the PDF that was reported.
   */
  it('is what one shared query could not do', async () => {
    const { store } = storeOver(CATALOGUE);
    const shared = await store.listUpcoming({
      venueIds: VENUES.map((v) => v.id),
      now: NOW,
      until: new Date(NOW.getTime() + briefFetchWindowDays(REPORTED, NOW) * 86_400_000),
      limit: 500,
    });
    const sections = buildBriefSections(shared, REPORTED, VENUES, NOW);
    expect(sections.map((s) => s.category)).toEqual(['cinema']);
  });

  it('narrows by category for a category rule, and by venue for a tag rule', async () => {
    const sub = makeSub({
      sendCadence: 'daily',
      categoryRules: [
        makeRule({ category: 'exhibition', sortOrder: 0 }),
        makeRule({ category: 'arthouse', sortOrder: 1 }),
      ],
    });
    const { queries, store } = storeOver(CATALOGUE);
    await fetchBriefEvents(sub, VENUES, store, NOW);

    expect(queries).toHaveLength(2);
    // A built-in category is a column, so it goes in the `where`.
    expect(queries[0]!.categories).toEqual(['exhibition']);
    expect(queries[0]!.venueIds).toEqual(['kino', 'msn', 'teatr']);
    // A tag is a set of venues, so that is what narrows instead.
    expect(queries[1]!.categories).toBeUndefined();
    expect(queries[1]!.venueIds).toEqual(['kino']);
  });

  it('spends no query on a tag no followed venue carries', async () => {
    const sub = makeSub({
      sendCadence: 'daily',
      categoryRules: [makeRule({ category: 'nobody-has-this-tag' })],
    });
    const { queries, store } = storeOver(CATALOGUE);
    expect(await fetchBriefEvents(sub, VENUES, store, NOW)).toEqual([]);
    expect(queries).toEqual([]);
  });

  it('gives each section its own window rather than one shared widest', async () => {
    const sub = makeSub({
      sendCadence: 'daily',
      categoryRules: [
        makeRule({ category: 'cinema', sortOrder: 0 }),
        makeRule({ category: 'exhibition', lookaheadDays: 30, sortOrder: 1 }),
      ],
    });
    const { queries, store } = storeOver(CATALOGUE);
    await fetchBriefEvents(sub, VENUES, store, NOW);

    expect(queries[0]!.until?.getTime()).toBe(NOW.getTime() + 1 * 86_400_000);
    expect(queries[1]!.until?.getTime()).toBe(NOW.getTime() + 30 * 86_400_000);
  });

  it('deduplicates an event two rules both reach, and orders by start', async () => {
    const sub = makeSub({
      sendCadence: 'daily',
      // 'cinema' the category and 'arthouse' the tag both reach the same venue.
      categoryRules: [makeRule({ category: 'cinema', sortOrder: 0 }), makeRule({ category: 'arthouse', sortOrder: 1 })],
    });
    const { store } = storeOver(CATALOGUE);
    const events = await fetchBriefEvents(sub, VENUES, store, NOW);

    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    const starts = events.map((e) => e.startsAt);
    expect([...starts].sort()).toEqual(starts);
  });

  it('asks nothing of the database when no venue is in scope', async () => {
    const { queries, store } = storeOver(CATALOGUE);
    expect(await fetchBriefEvents(makeSub({}), [], store, NOW)).toEqual([]);
    expect(queries).toEqual([]);
  });
});

/**
 * Why a category the reader configured is not in the issue they generated
 * (GOI-106).
 *
 * The brief itself is right to print only what it contains. "Generate now" is
 * not: it exists to show what the settings produce, and a monthly rule appears
 * in one issue in thirty, so on the other twenty-nine a reader sees cinema and
 * cannot tell a lost setting from a quiet month from a section that simply
 * rides a different issue.
 */
describe('ruleDueness (GOI-106)', () => {
  const section = (category: string, events: number) => ({
    category, windowDays: 1, detail: 'short' as const,
    events: Array.from({ length: events }, (_, i) => makeEvent({ id: `${category}-${i}` })),
  });

  it('names the issue a not-due rule rides, per cadence', () => {
    const sub = makeSub({
      sendCadence: 'daily',
      categoryRules: [
        makeRule({ category: 'cinema', sortOrder: 0 }),
        makeRule({ category: 'exhibition', cadence: 'monthly', sortOrder: 1 }),
        makeRule({ category: 'theatre', cadence: 'weekly', cadenceWeekday: 1, sortOrder: 2 }),
      ],
    });
    // NOW is Wednesday the 22nd: neither the 1st, nor the Monday the theatre
    // rule names.
    const report = ruleDueness(sub, [section('cinema', 4)], NOW);

    expect(report[0]).toEqual({ category: 'cinema', due: true, events: 4, nextIssue: null });
    expect(report[1]!.due).toBe(false);
    expect(report[1]!.nextIssue).toMatch(/1st of the month/);
    expect(report[2]!.due).toBe(false);
    expect(report[2]!.nextIssue).toMatch(/Monday/);
  });

  /** Due but empty is a different answer from not due, and says so. */
  it('tells "nothing on" apart from "not in this issue"', () => {
    const sub = makeSub({
      sendCadence: 'daily',
      categoryRules: [makeRule({ category: 'theatre' })],
    });
    const report = ruleDueness(sub, [], NOW);
    expect(report[0]).toEqual({ category: 'theatre', due: true, events: 0, nextIssue: null });
  });

  it('reports every configured category, in the order they are configured', () => {
    const sub = makeSub({
      sendCadence: 'weekly',
      categoryRules: [
        makeRule({ category: 'cinema', sortOrder: 0 }),
        makeRule({ category: 'exhibition', sortOrder: 1 }),
        makeRule({ category: 'theatre', sortOrder: 2 }),
      ],
    });
    const report = ruleDueness(sub, [section('exhibition', 2)], NOW);
    expect(report.map((r) => r.category)).toEqual(['cinema', 'exhibition', 'theatre']);
    expect(report.map((r) => r.events)).toEqual([0, 2, 0]);
  });
});

/**
 * The reported setup, end to end (GOI-106).
 *
 * Cinema every issue looking a day ahead with a 17:00 cutoff; museums and
 * theatre every issue looking thirty days ahead at any time. A daily
 * newsletter. Every rule is due in every issue, so nothing here is a cadence
 * question — and the brief still arrived as cinema alone.
 *
 * Two independent causes, either of which empties a section on its own:
 * the museum's shows are runs whose opening date has passed
 * (`selectBriefEvents`), and the theatre's dates sit beyond where 500 rows of
 * cinema stopped (`fetchBriefEvents`). Both are asserted from the settings the
 * reader actually had.
 */
describe('the reported newsletter, section by section (GOI-106)', () => {
  const VENUES = [
    { id: 'kino', name: 'Kinoteka', category: 'cinema', tags: [] },
    { id: 'msn', name: 'MSN', category: 'exhibition', tags: [] },
    { id: 'teatr', name: 'Teatr Polski', category: 'theatre', tags: [] },
  ] as unknown as Parameters<typeof fetchBriefEvents>[1];

  const SUB = makeSub({
    sendCadence: 'daily',
    categoryRules: [
      makeRule({ category: 'cinema', lookaheadDays: 1, timeFilter: 'after_17', sortOrder: 0 }),
      makeRule({ category: 'exhibition', lookaheadDays: 30, sortOrder: 1 }),
      makeRule({ category: 'theatre', lookaheadDays: 30, sortOrder: 2 }),
    ],
  });

  /** Warsaw as it actually is: a cinema several times an evening, a museum
   *  running two shows that opened months ago, a theatre playing next month. */
  const CATALOGUE: Event[] = [
    // NOW is noon in Warsaw, so +6h..+9h is 18:00-21:00 — an evening the
    // cinema row's "after 17:00" actually keeps.
    ...[6, 7, 8, 9].map((offset) => makeEvent({
      id: `kino-${offset}`, venueId: 'kino', category: 'cinema', kind: 'timed',
      startsAt: new Date(NOW.getTime() + offset * 3_600_000).toISOString(),
    })),
    makeEvent({
      id: 'formy', venueId: 'msn', category: 'exhibition', kind: 'exhibition',
      startsAt: '2026-06-01T00:00:00+02:00', endsAt: '2026-10-24T00:00:00+02:00',
    }),
    makeEvent({
      id: 'dzieci', venueId: 'msn', category: 'exhibition', kind: 'exhibition',
      startsAt: '2026-05-10T00:00:00+02:00', endsAt: '2026-09-14T00:00:00+02:00',
    }),
    makeEvent({
      id: 'hamlet', venueId: 'teatr', category: 'theatre', kind: 'timed',
      startsAt: new Date(NOW.getTime() + 21 * 86_400_000).toISOString(),
    }),
  ];

  it('carries all three sections, not cinema alone', async () => {
    const events = await fetchBriefEvents(SUB, VENUES, {
      listUpcoming: async () => CATALOGUE,
    }, NOW);
    const sections = buildBriefSections(events, SUB, VENUES, NOW);

    expect(sections.map((s) => s.category)).toEqual(['cinema', 'exhibition', 'theatre']);
    expect(sections[1]!.events.map((e) => e.id)).toEqual(['dzieci', 'formy']);
    expect(sections[2]!.events.map((e) => e.id)).toEqual(['hamlet']);
  });

  /** And every category is accounted for on the screen, in this issue or a
   *  later one — which is how the reader could have seen any of this. */
  it('reports all three back to the reader', async () => {
    const events = await fetchBriefEvents(SUB, VENUES, {
      listUpcoming: async () => CATALOGUE,
    }, NOW);
    const report = ruleDueness(SUB, buildBriefSections(events, SUB, VENUES, NOW), NOW);
    expect(report.map((r) => [r.category, r.due, r.events])).toEqual([
      ['cinema', true, 4],
      ['exhibition', true, 2],
      ['theatre', true, 1],
    ]);
  });
});

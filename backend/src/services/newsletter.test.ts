import { describe, it, expect } from 'vitest';
import type { Event, NewsletterCategoryRule } from '@afisz/shared';
import type { BriefScope } from './newsletter.js';
import {
  briefWindowDays,
  selectBriefEvents,
  isDue,
  dueSlot,
  resolveBriefVenues,
  sendNewsletterBriefs,
  buildBriefSections,
  eventInCategory,
  briefSubject,
  wasRecentlySent,
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

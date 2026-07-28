import { describe, it, expect } from 'vitest';
import type { Event } from '@goin/shared';
import {
  briefWindowDays,
  selectBriefEvents,
  isWeeklySendDay,
  isSendHour,
  resolveBriefVenues,
  buildBriefSections,
  isRuleDue,
  eventInCategory,
  briefSubject,
  wasRecentlySent,
} from './newsletter.js';
import { InMemoryUserVenueStore } from './user-venue-store.js';
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

function makeSub(over: Partial<NewsletterSubscription>): NewsletterSubscription {
  return {
    userId: 'u1',
    email: 'user@example.com',
    recipientName: null,
    frequency: 'daily',
    venueIds: [],
    afterHour: null,
    beforeHour: null,
    sendHour: 8,
    sendWeekday: 1,
    categoryRules: [],
    enabled: true,
    lastSentAt: null,
    ...over,
  };
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

describe('isRuleDue', () => {
  const monday = new Date('2026-07-20T06:00:00Z');
  const wednesday = new Date('2026-07-22T06:00:00Z');
  const firstOfMonth = new Date('2026-08-01T06:00:00Z');

  it('is always due when daily', () => {
    expect(isRuleDue('daily', wednesday, 1)).toBe(true);
  });

  it('is due weekly only on the subscription\'s send weekday', () => {
    expect(isRuleDue('weekly', monday, 1)).toBe(true);
    expect(isRuleDue('weekly', wednesday, 1)).toBe(false);
    expect(isRuleDue('weekly', wednesday, 3)).toBe(true);
  });

  it('is due monthly only on the 1st', () => {
    expect(isRuleDue('monthly', firstOfMonth, 1)).toBe(true);
    expect(isRuleDue('monthly', wednesday, 1)).toBe(false);
  });
});

describe('briefSubject', () => {
  const s = (frequency: 'daily' | 'weekly' | 'monthly') =>
    ({ category: 'x', frequency, detail: 'short' as const, events: [] });

  it('reads to the widest cadence in the email', () => {
    expect(briefSubject([s('daily')])).toMatch(/today/i);
    expect(briefSubject([s('daily'), s('weekly')])).toMatch(/week/i);
    expect(briefSubject([s('daily'), s('monthly')])).toMatch(/month/i);
  });
});

describe('selectBriefEvents', () => {
  it('keeps only events inside the cadence window', () => {
    const today = makeEvent({ id: 'today', startsAt: '2026-07-22T20:00:00+02:00' });
    const nextWeek = makeEvent({ id: 'next-week', startsAt: '2026-07-27T20:00:00+02:00' });
    const past = makeEvent({ id: 'past', startsAt: '2026-07-21T20:00:00+02:00' });

    const daily = selectBriefEvents([today, nextWeek, past], makeSub({ frequency: 'daily' }), NOW);
    expect(daily.map((e) => e.id)).toEqual(['today']);

    const weekly = selectBriefEvents([today, nextWeek, past], makeSub({ frequency: 'weekly' }), NOW);
    expect(weekly.map((e) => e.id)).toEqual(['today', 'next-week']);
  });

  it('scopes to the chosen venues; empty selection means all', () => {
    const a = makeEvent({ id: 'a', venueId: 'v1' });
    const b = makeEvent({ id: 'b', venueId: 'v2' });

    expect(selectBriefEvents([a, b], makeSub({ venueIds: ['v2'] }), NOW).map((e) => e.id)).toEqual(['b']);
    expect(selectBriefEvents([a, b], makeSub({ venueIds: [] }), NOW)).toHaveLength(2);
  });

  it('applies the after-hour filter on the Warsaw clock ("after 6 pm")', () => {
    const matinee = makeEvent({ id: 'matinee', startsAt: '2026-07-22T15:00:00+02:00' });
    const evening = makeEvent({ id: 'evening', startsAt: '2026-07-22T18:30:00+02:00' });

    const picked = selectBriefEvents([matinee, evening], makeSub({ afterHour: 18 }), NOW);
    expect(picked.map((e) => e.id)).toEqual(['evening']);
  });

  it('applies the before-hour filter', () => {
    const matinee = makeEvent({ id: 'matinee', startsAt: '2026-07-22T15:00:00+02:00' });
    const evening = makeEvent({ id: 'evening', startsAt: '2026-07-22T20:00:00+02:00' });

    const picked = selectBriefEvents([matinee, evening], makeSub({ beforeHour: 18 }), NOW);
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
    const sections = buildBriefSections(week(), makeSub({ frequency: 'daily' }), VENUES, NOW);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.category).toBe('');
    expect(sections[0]!.events.map((e) => e.id).sort()).toEqual(['comedy-today', 'film-today']);
  });

  it('gives each category its own window, so a weekly section reaches further', () => {
    const sections = buildBriefSections(
      week(),
      makeSub({
        categoryRules: [
          { category: 'cinema', frequency: 'weekly', detail: 'short' },
          { category: 'comedy', frequency: 'daily', detail: 'full' },
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
          { category: 'cinema', frequency: 'daily', detail: 'short' },
          { category: 'comedy', frequency: 'monthly', detail: 'full' },
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
          { category: 'cinema', frequency: 'daily', detail: 'short' },
          { category: 'comedy', frequency: 'monthly', detail: 'full' },
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
      makeSub({ categoryRules: [{ category: 'arthouse', frequency: 'daily', detail: 'short' }] }),
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
          { category: 'cinema', frequency: 'daily', detail: 'short' },
          { category: 'arthouse', frequency: 'daily', detail: 'full' },
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
      makeSub({ categoryRules: [{ category: 'opera', frequency: 'daily', detail: 'short' }] }),
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

describe('isWeeklySendDay', () => {
  it('defaults to Mondays in Warsaw', () => {
    expect(isWeeklySendDay(new Date('2026-07-20T06:00:00Z'))).toBe(true); // Monday
    expect(isWeeklySendDay(new Date('2026-07-22T06:00:00Z'))).toBe(false); // Wednesday
  });

  it('honours the subscription\'s chosen weekday (GOI-28)', () => {
    const wednesday = new Date('2026-07-22T06:00:00Z');
    expect(isWeeklySendDay(wednesday, 3)).toBe(true);
    expect(isWeeklySendDay(wednesday, 1)).toBe(false);
  });
});

describe('isSendHour', () => {
  it('compares against the Warsaw wall clock, not UTC', () => {
    // 06:00 UTC is 08:00 in Warsaw (CEST).
    const at = new Date('2026-07-22T06:00:00Z');
    expect(isSendHour(at, 8)).toBe(true);
    expect(isSendHour(at, 6)).toBe(false);
    // Default matches the pre-GOI-28 fixed hour.
    expect(isSendHour(at)).toBe(true);
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

describe('InMemoryNewsletterStore', () => {
  it('saves and reads back settings, preserving lastSentAt across saves', async () => {
    const store = new InMemoryNewsletterStore();
    await store.save('u1', {
      email: 'a@b.pl',
      frequency: 'daily',
      venueIds: ['v1'],
      afterHour: 18,
      enabled: true,
    });
    await store.markSent('u1', new Date('2026-07-22T06:00:00Z'));
    const updated = await store.save('u1', {
      email: 'a@b.pl',
      frequency: 'weekly',
      venueIds: ['v1', 'v2'],
      enabled: true,
    });

    expect(updated.frequency).toBe('weekly');
    expect(updated.lastSentAt).toBe('2026-07-22T06:00:00.000Z');
  });

  it('listEnabled returns only enabled subscriptions', async () => {
    const store = new InMemoryNewsletterStore();
    await store.save('on', { email: 'on@x.pl', frequency: 'daily', venueIds: [], enabled: true });
    await store.save('off', { email: 'off@x.pl', frequency: 'daily', venueIds: [], enabled: false });

    const subs = await store.listEnabled();
    expect(subs.map((s) => s.userId)).toEqual(['on']);
  });
});

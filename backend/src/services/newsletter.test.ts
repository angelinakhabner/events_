import { describe, it, expect } from 'vitest';
import type { Event } from '@goin/shared';
import {
  briefWindowDays,
  selectBriefEvents,
  isWeeklySendDay,
  isSendHour,
  resolveBriefVenueIds,
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
    eventTags: [],
    enabled: true,
    lastSentAt: null,
    ...over,
  };
}

describe('briefWindowDays', () => {
  it('is 1 day for daily and 7 for weekly', () => {
    expect(briefWindowDays('daily')).toBe(1);
    expect(briefWindowDays('weekly')).toBe(7);
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

// Both of the form's scoping controls — the venue checkboxes and the tag
// categories — land here, because a tag is only ever a way of picking venues.
describe('resolveBriefVenueIds', () => {
  const KINOTEKA = {
    name: 'Kinoteka', url: 'https://kinoteka.example/', category: 'cinema' as const,
    city: 'Warsaw', country: 'PL',
  };
  const KOMEDIOWY = { ...KINOTEKA, name: 'Klub Komediowy', url: 'https://komediowy.example/', category: 'comedy' as const };

  /** One user with two venues: a tagged cinema and an untagged comedy club. */
  async function twoVenues() {
    const venues = new InMemoryUserVenueStore([]);
    const cinema = await venues.addCustom('u1', KINOTEKA);
    const comedy = await venues.addCustom('u1', KOMEDIOWY);
    await venues.update('u1', cinema.id, { tags: ['Arthouse', 'date night'] });
    return { venues, cinema, comedy };
  }

  it('keeps an explicit venue selection', async () => {
    const { venues, cinema } = await twoVenues();
    expect(await resolveBriefVenueIds('u1', [cinema.id], [], venues)).toEqual([cinema.id]);
  });

  it('expands an empty selection to the user\'s own venues, not every venue', async () => {
    const venues = new InMemoryUserVenueStore();
    await venues.ensureSeeded('u1');
    const mine = (await venues.listAll('u1')).map((v) => v.id);

    expect(mine.length).toBeGreaterThan(0);
    expect(await resolveBriefVenueIds('u1', [], [], venues)).toEqual(mine);
    // A user who follows nothing resolves to nothing — the sweep skips them
    // rather than mailing them the whole database.
    expect(await resolveBriefVenueIds('nobody', [], [], new InMemoryUserVenueStore([]))).toEqual([]);
  });

  it('narrows to the venues carrying a chosen tag, case-insensitively', async () => {
    const { venues, cinema } = await twoVenues();
    expect(await resolveBriefVenueIds('u1', [], ['arthouse'], venues)).toEqual([cinema.id]);
    expect(await resolveBriefVenueIds('u1', [], ['Date Night'], venues)).toEqual([cinema.id]);
  });

  it('treats several tags as "any of"', async () => {
    const { venues, cinema, comedy } = await twoVenues();
    await venues.update('u1', comedy.id, { tags: ['late night'] });
    const picked = await resolveBriefVenueIds('u1', [], ['arthouse', 'late night'], venues);
    expect(picked.sort()).toEqual([cinema.id, comedy.id].sort());
  });

  it('intersects tags with an explicit venue selection', async () => {
    const { venues, cinema, comedy } = await twoVenues();
    // The comedy club is picked but carries no matching tag → nothing in scope,
    // which the sweep reads as "skip", never as "send everything".
    expect(await resolveBriefVenueIds('u1', [comedy.id], ['arthouse'], venues)).toEqual([]);
    expect(await resolveBriefVenueIds('u1', [cinema.id], ['arthouse'], venues)).toEqual([cinema.id]);
  });

  it('resolves to nothing when no venue carries the tag', async () => {
    const { venues } = await twoVenues();
    expect(await resolveBriefVenueIds('u1', [], ['nonexistent'], venues)).toEqual([]);
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
  it('skips a daily sub sent a few hours ago but not one sent yesterday', () => {
    expect(wasRecentlySent(makeSub({ lastSentAt: '2026-07-22T06:00:00Z' }), NOW)).toBe(true);
    expect(wasRecentlySent(makeSub({ lastSentAt: '2026-07-21T06:00:00Z' }), NOW)).toBe(false);
  });

  it('never skips a sub that was never sent', () => {
    expect(wasRecentlySent(makeSub({ lastSentAt: null }), NOW)).toBe(false);
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

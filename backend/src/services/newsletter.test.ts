import { describe, it, expect } from 'vitest';
import type { Event } from '@goin/shared';
import {
  briefWindowDays,
  selectBriefEvents,
  renderBriefHtml,
  isWeeklySendDay,
  wasRecentlySent,
} from './newsletter.js';
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
    frequency: 'daily',
    venueIds: [],
    afterHour: null,
    beforeHour: null,
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

describe('renderBriefHtml', () => {
  it('groups events by day and links each title', () => {
    const events = [
      makeEvent({ title: 'Film A', startsAt: '2026-07-22T18:00:00+02:00', sourceUrl: 'https://x.pl/a' }),
      makeEvent({ title: 'Film B', startsAt: '2026-07-23T20:00:00+02:00', sourceUrl: 'https://x.pl/b' }),
    ];
    const html = renderBriefHtml(events, 'weekly');
    expect(html).toContain('This week at your venues');
    expect(html).toContain('Film A');
    expect(html).toContain('https://x.pl/b');
    expect(html).toContain('Kinoteka');
    // Two day headings.
    expect(html.match(/<h3/g)).toHaveLength(2);
  });

  it('escapes HTML in titles', () => {
    const html = renderBriefHtml([makeEvent({ title: '<script>alert(1)</script>' })], 'daily');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('isWeeklySendDay', () => {
  it('is true on Mondays in Warsaw and false otherwise', () => {
    expect(isWeeklySendDay(new Date('2026-07-20T06:00:00Z'))).toBe(true); // Monday
    expect(isWeeklySendDay(new Date('2026-07-22T06:00:00Z'))).toBe(false); // Wednesday
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

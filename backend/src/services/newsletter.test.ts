import { describe, it, expect } from 'vitest';
import type { Event } from '@goin/shared';
import {
  briefWindowDays,
  selectBriefEvents,
  renderBriefHtml,
  isWeeklySendDay,
  isSendHour,
  isDue,
  dueSlot,
  resolveBriefVenueIds,
  sendNewsletterBriefs,
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

function makeSub(over: Partial<NewsletterSubscription>): NewsletterSubscription {
  return {
    userId: 'u1',
    email: 'user@example.com',
    frequency: 'daily',
    venueIds: [],
    afterHour: null,
    beforeHour: null,
    sendHour: 8,
    sendWeekday: 1,
    eventDayMode: 'all',
    eventDay: null,
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

  // GOI-28: "all the events" / "events happening every day" / "a specific day".
  describe('event day scope', () => {
    /** A weekly window (Wed 22nd → Wed 29th) with one title on every day and
     *  one that plays a single evening. */
    function weekOfEvents() {
      const daily = ['22', '23', '24', '25', '26', '27', '28', '29'].map((d) =>
        makeEvent({ id: `daily-${d}`, title: 'Every Day', startsAt: `2026-07-${d}T20:00:00+02:00` }),
      );
      const oneOff = makeEvent({ id: 'one-off', title: 'One Night', startsAt: '2026-07-24T20:00:00+02:00' });
      return [...daily, oneOff];
    }

    it('keeps everything under "all"', () => {
      const picked = selectBriefEvents(weekOfEvents(), makeSub({ frequency: 'weekly', eventDayMode: 'all' }), NOW);
      expect(picked.map((e) => e.title)).toContain('One Night');
      expect(picked.map((e) => e.title)).toContain('Every Day');
    });

    it('keeps only titles running every day of the window under "daily"', () => {
      const picked = selectBriefEvents(weekOfEvents(), makeSub({ frequency: 'weekly', eventDayMode: 'daily' }), NOW);
      expect(new Set(picked.map((e) => e.title))).toEqual(new Set(['Every Day']));
    });

    it('keeps only the chosen weekday under "specific"', () => {
      // Friday the 24th is the only Friday in the window.
      const picked = selectBriefEvents(
        weekOfEvents(),
        makeSub({ frequency: 'weekly', eventDayMode: 'specific', eventDay: 5 }),
        NOW,
      );
      expect(picked.map((e) => e.id).sort()).toEqual(['daily-24', 'one-off']);
    });

    it('falls back to everything when "specific" has no day picked', () => {
      const events = weekOfEvents();
      const picked = selectBriefEvents(
        events,
        makeSub({ frequency: 'weekly', eventDayMode: 'specific', eventDay: null }),
        NOW,
      );
      const all = selectBriefEvents(events, makeSub({ frequency: 'weekly', eventDayMode: 'all' }), NOW);
      expect(picked.map((e) => e.id)).toEqual(all.map((e) => e.id));
    });
  });
});

describe('resolveBriefVenueIds', () => {
  it('keeps an explicit selection', async () => {
    const venues = new InMemoryUserVenueStore();
    expect(await resolveBriefVenueIds('u1', ['v1', 'v2'], venues)).toEqual(['v1', 'v2']);
  });

  it('expands an empty selection to the user\'s own venues, not every venue', async () => {
    const venues = new InMemoryUserVenueStore();
    await venues.ensureSeeded('u1');
    const mine = (await venues.listAll('u1')).map((v) => v.id);

    expect(mine.length).toBeGreaterThan(0);
    expect(await resolveBriefVenueIds('u1', [], venues)).toEqual(mine);
    // A user who follows nothing resolves to nothing — the sweep skips them
    // rather than mailing them the whole database.
    expect(await resolveBriefVenueIds('nobody', [], new InMemoryUserVenueStore([]))).toEqual([]);
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
    const sub = makeSub({ frequency: 'weekly', sendWeekday: 1, sendHour: 8 });
    expect(dueSlot(sub, NOW)?.toISOString()).toBe('2026-07-20T06:00:00.000Z');
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

  it('is due again once the next day\'s slot comes round', () => {
    const sub = makeSub({ sendHour: 8, lastSentAt: '2026-07-22T06:00:00Z' });
    expect(isDue(sub, new Date('2026-07-23T06:00:00Z'))).toBe(true);
  });

  it('holds a weekly brief until its weekday', () => {
    const sub = makeSub({ frequency: 'weekly', sendWeekday: 1, sendHour: 8, lastSentAt: '2026-07-20T06:00:00Z' });
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
   *  and these fixtures' user ids aren't UUIDs. */
  function deps() {
    return {
      venues: new InMemoryUserVenueStore([]),
      events: { listUpcoming: async () => [] },
    };
  }

  it('reports why nothing was sent instead of skipping silently', async () => {
    const store = await storeWith({
      email: 'a@b.pl', frequency: 'daily', venueIds: [], sendHour: 8, enabled: true,
    });
    // 03:00 Warsaw — no slot in the catch-up window.
    const res = await sendNewsletterBriefs(store, new Date('2026-07-22T01:00:00Z'), { ...deps(), dryRun: true });

    expect(res.sent).toBe(0);
    expect(res.outcomes).toHaveLength(1);
    expect(res.outcomes[0]).toMatchObject({ email: 'a@b.pl', status: 'skipped', reason: 'not-due' });
  });

  it('force ignores the schedule but still needs venues', async () => {
    const store = await storeWith({
      email: 'a@b.pl', frequency: 'daily', venueIds: [], sendHour: 8, enabled: true,
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
      email: 'a@b.pl', frequency: 'weekly', venueIds: ['v1', 'v2'], sendHour: 8, sendWeekday: 1, enabled: true,
    });
    const queries: EventListInput[] = [];
    await sendNewsletterBriefs(store, NOW, {
      ...deps(),
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
    await store.save('u1', { email: 'a@b.pl', frequency: 'daily', venueIds: [], enabled: true });
    await store.save('u2', { email: 'c@d.pl', frequency: 'daily', venueIds: [], enabled: true });

    const res = await sendNewsletterBriefs(store, NOW, { ...deps(), dryRun: true, only: 'c@d.pl' });
    expect(res.outcomes.map((o) => o.email)).toEqual(['c@d.pl']);
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

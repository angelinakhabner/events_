import { describe, it, expect, vi } from 'vitest';
import type { Event } from '@afisz/shared';
import { wantToGoState, productionKey } from '@afisz/shared';
import {
  applyChangeDedup, applyQueueDedup, changeState, isEmptySection, isUrgent,
  queueCandidates, statesToRecord, urgentSendAllowed,
  URGENT_MIN_GAP_HOURS,
} from './want-to-go-queue.js';
import { buildWantToGoSection, recordWantToGoSent, sendNewsletterBriefs, sendUrgentChanges } from './newsletter.js';
import { InMemoryNewsletterStore } from './newsletter-store.js';

/**
 * GOI-101: the "want to go" reminder queue.
 *
 * The whole design is that the *state* is the dedup key, not the event. A
 * saved play should be mentioned once as "this week", again as "tomorrow", and
 * again as "last chance" — three different things to tell someone about one
 * event — while never being mentioned twice in the same state, however many
 * issues fall inside its horizon. A per-event flag cannot express that: it can
 * only choose between repeating everything and saying each thing once.
 */
const NOW = new Date('2026-09-07T10:00:00Z'); // Monday

function ev(over: Partial<Event> & { id: string; startsAt: string }): Event {
  return {
    venueId: 'v1',
    venue: { id: 'v1', name: 'Teatr Dramatyczny', category: 'theatre', city: 'Warsaw', country: 'PL' },
    title: 'Dziady',
    description: null,
    endsAt: null,
    kind: 'timed',
    category: 'theatre',
    language: 'pl',
    director: null,
    cast: [],
    durationMinutes: null,
    priceMin: null,
    priceMax: null,
    sourceUrl: 'https://example.com/e',
    sourceId: null,
    scrapedAt: NOW.toISOString(),
    cancelledAt: null,
    ...over,
  } as Event;
}

const scope = { horizonDays: 7, changesEnabled: true };

describe('wantToGoState', () => {
  it('calls the next calendar day "tomorrow", not "this week"', () => {
    const e = ev({ id: 'a', startsAt: '2026-09-08T18:00:00Z' });
    expect(wantToGoState(e, [e], NOW, 7)).toBe('tomorrow');
  });

  it('calls anything else inside the horizon "this week"', () => {
    const e = ev({ id: 'a', startsAt: '2026-09-11T18:00:00Z' });
    expect(wantToGoState(e, [e], NOW, 7)).toBe('this_week');
  });

  it('says nothing about an event beyond the horizon', () => {
    const e = ev({ id: 'a', startsAt: '2026-09-20T18:00:00Z' });
    expect(wantToGoState(e, [e], NOW, 7)).toBeNull();
  });

  it('says nothing about an event already past', () => {
    const e = ev({ id: 'a', startsAt: '2026-09-01T18:00:00Z' });
    expect(wantToGoState(e, [e], NOW, 7)).toBeNull();
  });

  /**
   * The ticket's own case: a final performance one day out is `last_chance`,
   * not `tomorrow`. A reader told only "tomorrow" will assume there is another
   * one next week, which is precisely the mistake this exists to prevent.
   */
  describe('the last chance', () => {
    const tomorrow = ev({ id: 'last', startsAt: '2026-09-08T18:00:00Z' });
    const earlier = ev({ id: 'earlier', startsAt: '2026-09-07T18:00:00Z' });

    it('outranks "tomorrow" on the final performance of a run', () => {
      expect(wantToGoState(tomorrow, [earlier, tomorrow], NOW, 7)).toBe('last_chance');
    });

    it('leaves an earlier performance of the same run alone', () => {
      expect(wantToGoState(earlier, [earlier, tomorrow], NOW, 7)).not.toBe('last_chance');
    });

    // A single performance is not "the last chance" in any useful sense — it
    // is simply the performance, and calling every one-off a last chance is
    // how the label stops meaning anything.
    it('is not claimed for a one-off', () => {
      expect(wantToGoState(tomorrow, [tomorrow], NOW, 7)).toBe('tomorrow');
    });

    // An exhibition runs continuously, so its urgency is its closing date;
    // its start is usually months past.
    it('is measured by the closing date for an exhibition', () => {
      const closing = ev({
        id: 'x', kind: 'exhibition',
        startsAt: '2026-06-01T10:00:00Z', endsAt: '2026-09-12T18:00:00Z',
      });
      expect(wantToGoState(closing, [closing], NOW, 7)).toBe('last_chance');

      const later = ev({
        id: 'y', kind: 'exhibition',
        startsAt: '2026-06-01T10:00:00Z', endsAt: '2026-11-12T18:00:00Z',
      });
      expect(wantToGoState(later, [later], NOW, 7)).toBe('ongoing');
    });
  });

  // GOI-125. Between them these two shapes are every exhibition a reader can
  // realistically save — the ones worth saving are the ones still open — and
  // both used to fall through to the start-date tests against an opening date
  // months past, so a saved exhibition simply never reached the brief.
  describe('an exhibition that is open', () => {
    it('is reported as ongoing when it closes beyond the horizon', () => {
      const run = ev({
        id: 'x', kind: 'exhibition',
        startsAt: '2026-06-01T10:00:00Z', endsAt: '2027-01-12T18:00:00Z',
      });
      expect(wantToGoState(run, [run], NOW, 7)).toBe('ongoing');
    });

    it('is reported as ongoing when it has no closing date at all', () => {
      const run = ev({
        id: 'x', kind: 'exhibition', startsAt: '2026-06-01T10:00:00Z', endsAt: null,
      });
      expect(wantToGoState(run, [run], NOW, 7)).toBe('ongoing');
    });

    it('is still nothing once it has closed', () => {
      const over = ev({
        id: 'x', kind: 'exhibition',
        startsAt: '2026-01-01T10:00:00Z', endsAt: '2026-02-01T18:00:00Z',
      });
      expect(wantToGoState(over, [over], NOW, 7)).toBeNull();
    });

    // Not open yet: dated by when it opens, like anything else — so a run
    // starting after the horizon is still outside this issue.
    it('is dated by its opening while it is still to come', () => {
      const soon = ev({
        id: 'x', kind: 'exhibition',
        startsAt: '2026-09-08T10:00:00Z', endsAt: '2027-01-12T18:00:00Z',
      });
      expect(wantToGoState(soon, [soon], NOW, 7)).toBe('tomorrow');

      const far = ev({
        id: 'y', kind: 'exhibition',
        startsAt: '2026-10-04T10:00:00Z', endsAt: '2027-01-12T18:00:00Z',
      });
      expect(wantToGoState(far, [far], NOW, 7)).toBeNull();
    });
  });
});

/**
 * Occurrences are grouped into productions by `(venueId, title)`, since the
 * schema has no production-level grouping. The heuristic is documented where
 * it lives; this pins what it does.
 */
describe('productionKey', () => {
  it('folds a run of the same play at one venue', () => {
    expect(productionKey({ venueId: 'v1', title: 'Dziady' }))
      .toBe(productionKey({ venueId: 'v1', title: '  dziady  ' }));
  });

  it('keeps the same title at two venues apart', () => {
    expect(productionKey({ venueId: 'v1', title: 'Dziady' }))
      .not.toBe(productionKey({ venueId: 'v2', title: 'Dziady' }));
  });
});

describe('queueCandidates', () => {
  it('puts the soonest first', () => {
    const later = ev({ id: 'b', title: 'B', startsAt: '2026-09-11T18:00:00Z' });
    const sooner = ev({ id: 'a', title: 'A', startsAt: '2026-09-09T18:00:00Z' });
    expect(queueCandidates([later, sooner], scope, NOW).map((q) => q.event.id))
      .toEqual(['a', 'b']);
  });

  it('leaves out what is outside the horizon', () => {
    const near = ev({ id: 'a', title: 'A', startsAt: '2026-09-09T18:00:00Z' });
    const far = ev({ id: 'b', title: 'B', startsAt: '2026-10-09T18:00:00Z' });
    expect(queueCandidates([near, far], scope, NOW).map((q) => q.event.id)).toEqual(['a']);
  });

  it('honours a horizon the reader narrowed', () => {
    const e = ev({ id: 'a', startsAt: '2026-09-11T18:00:00Z' });
    expect(queueCandidates([e], { ...scope, horizonDays: 2 }, NOW)).toHaveLength(0);
    expect(queueCandidates([e], { ...scope, horizonDays: 14 }, NOW)).toHaveLength(1);
  });
});

/** The heart of it: one event, three states, each said exactly once. */
describe('dedup by state', () => {
  const e = ev({ id: 'a', startsAt: '2026-09-09T18:00:00Z' });

  it('keeps an event whose state has not been sent', () => {
    const kept = applyQueueDedup([{ event: e, state: 'this_week' }], new Map());
    expect(kept).toHaveLength(1);
  });

  it('drops an event already sent in that state', () => {
    const sent = new Map([['this_week', new Set(['a'])]]);
    expect(applyQueueDedup([{ event: e, state: 'this_week' }], sent)).toHaveLength(0);
  });

  it('keeps the same event in a state it has not been sent in yet', () => {
    const sent = new Map([['this_week', new Set(['a'])]]);
    expect(applyQueueDedup([{ event: e, state: 'tomorrow' }], sent)).toHaveLength(1);
  });

  it('records every state an issue used', () => {
    const states = statesToRecord(
      [{ event: e, state: 'tomorrow' }],
      [{ event: e, type: 'cancelled', oldValue: null, newValue: null }],
    );
    expect([...states.keys()].sort()).toEqual(['change:cancelled', 'tomorrow']);
  });

  // A rescheduled-then-cancelled event reports both: the second does not make
  // the first untrue, and a reader who was told the time moved needs to know
  // it then went away.
  it('keys changes by type, so two changes to one event both report', () => {
    const changes = [
      { event: e, type: 'rescheduled' as const, oldValue: null, newValue: null },
      { event: e, type: 'cancelled' as const, oldValue: null, newValue: null },
    ];
    const sent = new Map([[changeState('rescheduled'), new Set(['a'])]]);
    expect(applyChangeDedup(changes, sent).map((c) => c.type)).toEqual(['cancelled']);
  });
});

describe('urgent sends', () => {
  const soon = ev({ id: 'a', startsAt: '2026-09-08T10:00:00Z' }); // 24h out
  const later = ev({ id: 'b', startsAt: '2026-09-20T10:00:00Z' });

  it('breaks the schedule for a cancellation within 48 hours', () => {
    expect(isUrgent({ event: soon, type: 'cancelled', oldValue: null, newValue: null }, NOW)).toBe(true);
  });

  it('breaks it for a reschedule too', () => {
    expect(isUrgent({ event: soon, type: 'rescheduled', oldValue: null, newValue: null }, NOW)).toBe(true);
  });

  // Disappointing, not urgent. And a change three weeks out keeps until the
  // next issue.
  it('does not break it for a sell-out, or for something far off', () => {
    expect(isUrgent({ event: soon, type: 'sold_out', oldValue: null, newValue: null }, NOW)).toBe(false);
    expect(isUrgent({ event: later, type: 'cancelled', oldValue: null, newValue: null }, NOW)).toBe(false);
  });

  /**
   * The rate limit is what makes urgent sends usable rather than a way to be
   * mailed six times in an afternoon when a festival drops a day's programme.
   */
  describe('the rate limit', () => {
    it('allows the first one', () => {
      expect(urgentSendAllowed(null, NOW)).toBe(true);
    });

    it('holds a second change ten minutes later', () => {
      const tenMinutesAgo = new Date(NOW.getTime() - 10 * 60_000).toISOString();
      expect(urgentSendAllowed(tenMinutesAgo, NOW)).toBe(false);
    });

    it('opens again after the gap', () => {
      const justInside = new Date(NOW.getTime() - (URGENT_MIN_GAP_HOURS * 3_600_000 - 1)).toISOString();
      const justOutside = new Date(NOW.getTime() - URGENT_MIN_GAP_HOURS * 3_600_000).toISOString();
      expect(urgentSendAllowed(justInside, NOW)).toBe(false);
      expect(urgentSendAllowed(justOutside, NOW)).toBe(true);
    });
  });
});

// ─── Through the store ───────────────────────────────────────────────────────

/** A saved-events store holding exactly what a test hands it. */
function savedStore(events: Event[]) {
  return { list: async () => events } as never;
}

async function config(store: InMemoryNewsletterStore, over: Record<string, unknown> = {}) {
  return store.save('u1', {
    email: 'a@b.pl',
    sendCadence: 'daily',
    venueIds: [],
    enabled: true,
    ...over,
  });
}

describe('buildWantToGoSection', () => {
  it('says nothing when the reader switched saved events off', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await config(store, {
      wantToGo: { enabled: false, horizonDays: 7, changesEnabled: true, urgentSend: true },
      categoryRules: [{ category: 'cinema', cadence: 'every_issue', cadenceWeekday: null, detail: 'short', timeFilter: 'any', lookaheadDays: null, sortOrder: 0 }],
    });
    const section = await buildWantToGoSection(
      { id: saved.id, userId: 'u1', wantToGo: saved.wantToGo, sendCadence: saved.sendCadence },
      store,
      savedStore([ev({ id: 'a', startsAt: '2026-09-08T18:00:00Z' })]),
      NOW,
    );
    expect(isEmptySection(section)).toBe(true);
  });

  /**
   * The behaviour the whole state-keyed design exists for: three consecutive
   * daily issues, one saved event, three different things said — and each said
   * once.
   */
  it('escalates one event across issues, saying each state exactly once', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await config(store);
    const sub = { id: saved.id, userId: 'u1', wantToGo: saved.wantToGo, sendCadence: saved.sendCadence };
    // A run, so the final night reads as a last chance.
    const events = [
      ev({ id: 'early', startsAt: '2026-09-09T18:00:00Z' }),
      ev({ id: 'last', startsAt: '2026-09-12T18:00:00Z' }),
    ];

    const said: string[] = [];
    for (const day of ['2026-09-07', '2026-09-08', '2026-09-11']) {
      const at = new Date(`${day}T10:00:00Z`);
      const section = await buildWantToGoSection(sub, store, savedStore(events), at);
      said.push(...section.reminders.map((r) => `${r.event.id}:${r.state}`));
      await recordWantToGoSent(saved.id, section, store, at);
    }

    // 7th: both in the week ahead, the later one already the last chance.
    // 8th: the earlier one is now tomorrow — a new state, so it is said again.
    // 11th: the last night is tomorrow, but stays "last chance", which it has
    // already been told, so it is not repeated.
    expect(said).toEqual(['early:this_week', 'last:last_chance', 'early:tomorrow']);
  });

  /**
   * The horizon is a floor, not a ceiling (GOI-125). A monthly reader on the
   * stored default of seven days was told about a saved event only when it
   * happened to fall in the week after an issue — three weeks in four,
   * everything they had saved went unmentioned and the block came out empty.
   */
  it('reaches as far ahead as the issue covers', async () => {
    const store = new InMemoryNewsletterStore();
    const events = [ev({ id: 'a', startsAt: '2026-09-25T18:00:00Z' })]; // 18 days out

    const daily = await config(store, { sendCadence: 'daily' });
    const inWeek = await buildWantToGoSection(
      { id: daily.id, userId: 'u1', wantToGo: daily.wantToGo, sendCadence: 'daily' },
      store, savedStore(events), NOW,
    );
    expect(inWeek.reminders).toHaveLength(0);

    const monthly = await buildWantToGoSection(
      { id: daily.id, userId: 'u1', wantToGo: daily.wantToGo, sendCadence: 'monthly' },
      store, savedStore(events), NOW,
    );
    expect(monthly.reminders.map((r) => r.event.id)).toEqual(['a']);
  });

  it('says the same thing once across three issues where nothing changed', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await config(store);
    const sub = { id: saved.id, userId: 'u1', wantToGo: saved.wantToGo, sendCadence: saved.sendCadence };
    const events = [ev({ id: 'a', startsAt: '2026-09-13T18:00:00Z' })];

    let total = 0;
    for (const day of ['2026-09-07', '2026-09-08', '2026-09-09']) {
      const at = new Date(`${day}T10:00:00Z`);
      const section = await buildWantToGoSection(sub, store, savedStore(events), at);
      total += section.reminders.length;
      await recordWantToGoSent(saved.id, section, store, at);
    }
    expect(total).toBe(1);
  });

  it('reports a change to a saved event, once', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await config(store);
    const sub = { id: saved.id, userId: 'u1', wantToGo: saved.wantToGo, sendCadence: saved.sendCadence };
    const cancelled = ev({
      id: 'a', startsAt: '2026-09-09T18:00:00Z', cancelledAt: '2026-09-06T09:00:00Z',
    });
    store.changes = [{
      eventId: 'a', changeType: 'cancelled', oldValue: null, newValue: null,
      detectedAt: '2026-09-06T09:00:00Z',
    }];

    const first = await buildWantToGoSection(sub, store, savedStore([cancelled]), NOW);
    expect(first.changes.map((c) => c.type)).toEqual(['cancelled']);
    // A cancelled event is not also a reminder — there is nothing to remind
    // anyone about.
    expect(first.reminders).toHaveLength(0);
    await recordWantToGoSent(saved.id, first, store, NOW);

    const second = await buildWantToGoSection(sub, store, savedStore([cancelled]), NOW);
    expect(second.changes).toHaveLength(0);
  });

  /**
   * GOI-123: no event twice in the one block that asks the reader to do
   * something. A rescheduled event is not cancelled, so it stayed in the
   * reminders as well as the changes, and the block said "moved to 20:15" and
   * then, three rows down, "tomorrow, 20:15".
   */
  it('does not also remind about an event the changes block names', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await config(store);
    const sub = { id: saved.id, userId: 'u1', wantToGo: saved.wantToGo, sendCadence: saved.sendCadence };
    const moved = ev({ id: 'a', startsAt: '2026-09-08T20:15:00Z' });
    store.changes = [{
      eventId: 'a', changeType: 'rescheduled',
      oldValue: '2026-09-08T18:00:00Z', newValue: '2026-09-08T20:15:00Z',
      detectedAt: '2026-09-06T09:00:00Z',
    }];

    const section = await buildWantToGoSection(sub, store, savedStore([moved]), NOW);
    expect(section.changes.map((c) => c.event.id)).toEqual(['a']);
    expect(section.reminders).toHaveLength(0);
  });

  it('still reminds about the saved events nothing happened to', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await config(store);
    const sub = { id: saved.id, userId: 'u1', wantToGo: saved.wantToGo, sendCadence: saved.sendCadence };
    const moved = ev({ id: 'a', startsAt: '2026-09-08T20:15:00Z' });
    const other = ev({ id: 'b', startsAt: '2026-09-09T19:00:00Z', title: 'Kordian' });
    store.changes = [{
      eventId: 'a', changeType: 'rescheduled', oldValue: null, newValue: null,
      detectedAt: '2026-09-06T09:00:00Z',
    }];

    const section = await buildWantToGoSection(sub, store, savedStore([moved, other]), NOW);
    expect(section.reminders.map((r) => r.event.id)).toEqual(['b']);
  });

  it('leaves changes out when the reader switched them off', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await config(store, {
      wantToGo: { enabled: true, horizonDays: 7, changesEnabled: false, urgentSend: false },
    });
    store.changes = [{
      eventId: 'a', changeType: 'cancelled', oldValue: null, newValue: null,
      detectedAt: '2026-09-06T09:00:00Z',
    }];
    const section = await buildWantToGoSection(
      { id: saved.id, userId: 'u1', wantToGo: saved.wantToGo, sendCadence: saved.sendCadence },
      store,
      savedStore([ev({ id: 'a', startsAt: '2026-09-09T18:00:00Z', cancelledAt: '2026-09-06T09:00:00Z' })]),
      NOW,
    );
    expect(section.changes).toHaveLength(0);
  });
});

/**
 * Suppression counts the queue as content (GOI-101). An issue whose cinema,
 * museums and theatre sections are all empty but which has saved events coming
 * up *is* sent — in August it is likely to be the only thing carrying the
 * newsletter, which is the intended behaviour rather than a degenerate case.
 */
describe('the sweep', () => {
  const venues = {
    listAll: async () => [{ id: 'v1', name: 'Teatr Dramatyczny', tags: [] }],
  } as never;
  const noEvents = { listUpcoming: async () => [] } as never;

  async function sweep(store: InMemoryNewsletterStore, saved: Event[], now: Date) {
    return sendNewsletterBriefs(store, now, {
      venues,
      events: noEvents,
      wantToGo: savedStore(saved),
      skipDrives: true,
      dryRun: true,
    });
  }

  it('sends an issue with no categories but a saved event coming up', async () => {
    const store = new InMemoryNewsletterStore();
    await config(store, { sendHour: 10, sendMinute: 0 });
    const result = await sweep(store, [ev({ id: 'a', startsAt: '2026-09-08T18:00:00Z' })], NOW);
    expect(result.outcomes[0]).toMatchObject({ status: 'sent' });
  });

  it('skips an issue where the categories and the queue are both empty', async () => {
    const store = new InMemoryNewsletterStore();
    await config(store, { sendHour: 10, sendMinute: 0 });
    const result = await sweep(store, [], NOW);
    expect(result.outcomes[0]).toMatchObject({ status: 'skipped', reason: 'no-events' });
  });

  /**
   * The queue reads the reader's saved events, not a venue listing, so it has
   * something to say with no venue followed at all — and used to be built
   * after the venue check, which skipped that reader as `no-venues` however
   * much they had saved (GOI-125).
   */
  it('sends an issue to a reader who follows no venues but has saved events', async () => {
    const store = new InMemoryNewsletterStore();
    await config(store, { sendHour: 10, sendMinute: 0 });
    const result = await sendNewsletterBriefs(store, NOW, {
      venues: { listAll: async () => [] } as never,
      events: noEvents,
      wantToGo: savedStore([ev({ id: 'a', startsAt: '2026-09-08T18:00:00Z' })]),
      skipDrives: true,
      dryRun: true,
    });
    expect(result.outcomes[0]).toMatchObject({ status: 'sent' });
  });

  it('still calls that reader no-venues when they have saved nothing either', async () => {
    const store = new InMemoryNewsletterStore();
    await config(store, { sendHour: 10, sendMinute: 0 });
    const result = await sendNewsletterBriefs(store, NOW, {
      venues: { listAll: async () => [] } as never,
      events: noEvents,
      wantToGo: savedStore([]),
      skipDrives: true,
      dryRun: true,
    });
    expect(result.outcomes[0]).toMatchObject({ status: 'skipped', reason: 'no-venues' });
  });

  /**
   * A failed send must not consume the states. Otherwise the reader is never
   * told, and the system believes they were — which is the one failure mode
   * that cannot be recovered from, since the next issue skips what it thinks
   * it already said.
   */
  it('does not record state when the send fails', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await config(store, { sendHour: 10, sendMinute: 0 });
    const event = ev({ id: 'a', startsAt: '2026-09-08T18:00:00Z' });
    const spy = vi.spyOn(store, 'recordSent');

    const result = await sendNewsletterBriefs(store, NOW, {
      venues,
      events: noEvents,
      wantToGo: savedStore([event]),
      skipDrives: true,
      send: async () => { throw new Error('mail server down'); },
    });

    // The send really did fail — otherwise this test would pass by never
    // reaching the send at all, which is how it passed before the seam
    // existed.
    expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(spy).not.toHaveBeenCalled();
    expect(await store.sentStates(saved.id, 'tomorrow', ['a'])).toEqual(new Set());
  });

  /** …and the next issue therefore still has it to say. */
  it('re-includes the event on the next issue after a failure', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await config(store, { sendHour: 10, sendMinute: 0 });
    const event = ev({ id: 'a', startsAt: '2026-09-08T18:00:00Z' });

    await sendNewsletterBriefs(store, NOW, {
      venues, events: noEvents, wantToGo: savedStore([event]), skipDrives: true,
      send: async () => { throw new Error('mail server down'); },
    });

    const next = await buildWantToGoSection(
      { id: saved.id, userId: 'u1', wantToGo: saved.wantToGo, sendCadence: saved.sendCadence },
      store,
      savedStore([event]),
      NOW,
    );
    expect(next.reminders.map((r) => r.event.id)).toEqual(['a']);
  });
});

/**
 * The off-schedule email (GOI-101). It carries the changes block and nothing
 * else — it exists to say one thing, and padding it with the week's listings
 * would bury that thing under them.
 */
describe('urgent change emails', () => {
  const soon = ev({ id: 'a', startsAt: '2026-09-08T09:00:00Z' }); // 23h out
  const cancelledSoon = { ...soon, cancelledAt: '2026-09-07T09:00:00Z' } as Event;

  function cancellation(store: InMemoryNewsletterStore) {
    store.changes = [{
      eventId: 'a', changeType: 'cancelled', oldValue: null, newValue: null,
      detectedAt: '2026-09-07T09:00:00Z',
    }];
  }

  it('goes out for a cancellation inside 48 hours', async () => {
    const store = new InMemoryNewsletterStore();
    await config(store);
    cancellation(store);
    const sent: { subject: string; html: string }[] = [];

    const result = await sendUrgentChanges(store, NOW, {
      wantToGo: savedStore([cancelledSoon]),
      send: async (m) => { sent.push({ subject: m.subject, html: m.html }); return { id: 'msg-1' }; },
    });

    expect(result.sent).toBe(1);
    expect(sent[0]!.subject).toMatch(/has been cancelled/i);
    // Only the change. No category sections rode along.
    // The brief speaks Polish (GOI-110); the marker beside the title does too.
    expect(sent[0]!.html).toContain('ODWO\u0141ANE');
    expect(sent[0]!.html).toContain('Dziady');
  });

  it('holds a second change inside the rate-limit window', async () => {
    const store = new InMemoryNewsletterStore();
    await config(store);
    cancellation(store);

    const first = await sendUrgentChanges(store, NOW, {
      wantToGo: savedStore([cancelledSoon]), send: async () => ({ id: 'msg-1' }),
    });
    expect(first.sent).toBe(1);

    // Another change ten minutes later, on a different saved event.
    store.changes = [{
      eventId: 'b', changeType: 'cancelled', oldValue: null, newValue: null,
      detectedAt: '2026-09-07T10:05:00Z',
    }];
    const other = ev({ id: 'b', title: 'Inne', startsAt: '2026-09-08T09:00:00Z', cancelledAt: '2026-09-07T10:05:00Z' });
    const second = await sendUrgentChanges(store, new Date('2026-09-07T10:10:00Z'), {
      wantToGo: savedStore([other]), send: async () => ({ id: 'msg-1' }),
    });
    expect(second.sent).toBe(0);
  });

  it('does not go out at all when the reader switched it off', async () => {
    const store = new InMemoryNewsletterStore();
    await config(store, {
      wantToGo: { enabled: true, horizonDays: 7, changesEnabled: true, urgentSend: false },
    });
    cancellation(store);
    const result = await sendUrgentChanges(store, NOW, {
      wantToGo: savedStore([cancelledSoon]), send: async () => ({ id: 'msg-1' }),
    });
    expect(result.sent).toBe(0);
  });

  it('leaves a change three weeks out to the next scheduled issue', async () => {
    const store = new InMemoryNewsletterStore();
    await config(store);
    store.changes = [{
      eventId: 'far', changeType: 'cancelled', oldValue: null, newValue: null,
      detectedAt: '2026-09-07T09:00:00Z',
    }];
    const far = ev({ id: 'far', startsAt: '2026-09-28T18:00:00Z', cancelledAt: '2026-09-07T09:00:00Z' });
    const result = await sendUrgentChanges(store, NOW, {
      wantToGo: savedStore([far]), send: async () => ({ id: 'msg-1' }),
    });
    expect(result.sent).toBe(0);
  });

  // The urgent email consumes the dedup state, so the scheduled issue does not
  // repeat what the reader has already been mailed about.
  it('does not report the same change again in the next issue', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await config(store);
    cancellation(store);
    await sendUrgentChanges(store, NOW, {
      wantToGo: savedStore([cancelledSoon]), send: async () => ({ id: 'msg-1' }),
    });

    const next = await buildWantToGoSection(
      { id: saved.id, userId: 'u1', wantToGo: saved.wantToGo, sendCadence: saved.sendCadence },
      store,
      savedStore([cancelledSoon]),
      NOW,
    );
    expect(next.changes).toHaveLength(0);
  });

  it('does not stamp the rate limit when the send fails', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await config(store);
    cancellation(store);
    await sendUrgentChanges(store, NOW, {
      wantToGo: savedStore([cancelledSoon]),
      send: async () => { throw new Error('mail server down'); },
    });
    // Nothing stamped, so the next attempt is free to try again.
    expect(await store.lastUrgentAt(saved.id)).toBeNull();
  });
});

/** Retention (GOI-100): send state older than 120 days refers to events months
 *  past and is telling nobody anything. */
describe('send-state retention', () => {
  it('drops rows older than the cutoff and keeps the rest', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await config(store);
    await store.recordSent(saved.id, 'this_week', ['old'], new Date('2026-01-01T00:00:00Z'));
    await store.recordSent(saved.id, 'this_week', ['new'], NOW);

    const dropped = await store.pruneSentEvents(new Date('2026-06-01T00:00:00Z'));
    expect(dropped).toBe(1);
    expect(await store.sentStates(saved.id, 'this_week', ['old', 'new'])).toEqual(new Set(['new']));
  });
});

import { describe, it, expect } from 'vitest';
import {
  FALLBACK_MAX_EVENTS,
  FALLBACK_MIN_EVENTS,
  bucketEvents,
  dedupeAllDay,
  isAllDay,
  periodKey,
  filterEventsByDay,
  filterEventsFromHour,
  splitExhibitions,
  exhibitionCoversDay,
  dayFilterRange,
  nextEventStart,
  visibleEvents,
  WEEK_FILTER,
  warsawDayKey,
  warsawHour,
} from './buckets';
import type { Event } from '@afisz/shared';

function evt(startsAt: string, id = startsAt): Event {
  return {
    id, venueId: 'v', title: id, description: null,
    startsAt, endsAt: null, category: 'cinema', language: 'pl',
    director: null, cast: [], durationMinutes: null,
    priceMin: null, priceMax: null,
    sourceUrl: 'https://x', sourceId: null, scrapedAt: '',
  };
}

describe('bucketEvents', () => {
  // "now" = 2026-06-08T16:00:00+02:00 (Mon afternoon in Warsaw)
  const now = new Date('2026-06-08T14:00:00.000Z');

  it('puts events within next 30 minutes in "soon"', () => {
    const events = [
      evt('2026-06-08T14:25:00.000Z', 'in25'), // +25min → soon
      evt('2026-06-08T14:35:00.000Z', 'in35'), // +35min → later today
    ];
    const buckets = bucketEvents(events, now);
    expect(buckets.find((b) => b.key === 'soon')?.items.map((e) => e.id)).toEqual(['in25']);
    expect(buckets.find((b) => b.key === 'today')?.items.map((e) => e.id)).toEqual(['in35']);
  });

  it('treats exactly 30 minutes from now as "soon" (inclusive)', () => {
    const e = evt('2026-06-08T14:30:00.000Z', 'edge');
    const buckets = bucketEvents([e], now);
    expect(buckets.find((b) => b.key === 'soon')?.items.map((x) => x.id)).toEqual(['edge']);
  });

  it('handles midnight rollover in Europe/Warsaw', () => {
    // 23:00 Warsaw on Mon vs 00:30 Warsaw on Tue
    const lateToday = evt('2026-06-08T21:00:00.000Z', 'late'); // 23:00 Warsaw Mon
    const earlyTomorrow = evt('2026-06-08T22:30:00.000Z', 'early'); // 00:30 Warsaw Tue
    const buckets = bucketEvents([lateToday, earlyTomorrow], now);
    expect(buckets.find((b) => b.key === 'today')?.items.map((e) => e.id)).toContain('late');
    expect(buckets.find((b) => b.key === 'tomorrow')?.items.map((e) => e.id)).toContain('early');
  });

  it('omits past events', () => {
    const buckets = bucketEvents([evt('2026-06-08T12:00:00.000Z', 'past')], now);
    expect(buckets.every((b) => b.items.every((e) => e.id !== 'past'))).toBe(true);
  });

  it('caps "this week" at 7 days from now', () => {
    const within = evt('2026-06-14T10:00:00.000Z', 'd6');
    const beyond = evt('2026-06-16T10:00:00.000Z', 'd8');
    const buckets = bucketEvents([within, beyond], now);
    const week = buckets.find((b) => b.key === 'thisWeek');
    expect(week?.items.map((e) => e.id)).toEqual(['d6']);
  });

  it('hides empty buckets', () => {
    const buckets = bucketEvents([], now);
    expect(buckets).toEqual([]);
  });
});

describe('filterEventsByDay', () => {
  const events = [
    evt('2026-06-08T21:00:00.000Z', 'mon-late'), // 23:00 Warsaw Mon
    evt('2026-06-08T22:30:00.000Z', 'tue-early'), // 00:30 Warsaw Tue
    evt('2026-06-09T10:00:00.000Z', 'tue-noon'), // 12:00 Warsaw Tue
  ];

  it('returns all events when no day is selected', () => {
    expect(filterEventsByDay(events, null)).toEqual(events);
  });

  it('keeps only events on the given Warsaw day', () => {
    expect(filterEventsByDay(events, '2026-06-09').map((e) => e.id)).toEqual([
      'tue-early',
      'tue-noon',
    ]);
    expect(filterEventsByDay(events, '2026-06-08').map((e) => e.id)).toEqual(['mon-late']);
  });

  it('drops events with unparseable start times', () => {
    expect(filterEventsByDay([evt('not-a-date', 'bad')], '2026-06-08')).toEqual([]);
  });
});

describe('warsawDayKey', () => {
  it('uses Europe/Warsaw timezone for day boundaries', () => {
    // 2026-06-08T22:30:00Z is 00:30 next day in Warsaw (CEST +02:00)
    expect(warsawDayKey(new Date('2026-06-08T22:30:00.000Z'))).toBe('2026-06-09');
    expect(warsawDayKey(new Date('2026-06-08T21:30:00.000Z'))).toBe('2026-06-08');
  });
});

describe('warsawHour', () => {
  it('reads the hour in Warsaw, not UTC', () => {
    // 17:00Z in June is 19:00 in Warsaw (CEST +02:00).
    expect(warsawHour(new Date('2026-06-08T17:00:00.000Z'))).toBe(19);
    // 17:00Z in January is 18:00 in Warsaw (CET +01:00) — DST is respected.
    expect(warsawHour(new Date('2026-01-08T17:00:00.000Z'))).toBe(18);
  });

  it('reports midnight as 0, not 24', () => {
    expect(warsawHour(new Date('2026-06-08T22:00:00.000Z'))).toBe(0);
  });
});

describe('filterEventsFromHour', () => {
  const events = [
    evt('2026-06-08T08:00:00.000Z', 'ten'), // 10:00 Warsaw
    evt('2026-06-08T14:00:00.000Z', 'four'), // 16:00 Warsaw
    evt('2026-06-08T18:00:00.000Z', 'eight'), // 20:00 Warsaw
  ];

  it('returns everything when no cutoff is set', () => {
    expect(filterEventsFromHour(events, null)).toEqual(events);
  });

  it('keeps events starting at or after the cutoff, in Warsaw time', () => {
    expect(filterEventsFromHour(events, 16).map((e) => e.id)).toEqual(['four', 'eight']);
    expect(filterEventsFromHour(events, 17).map((e) => e.id)).toEqual(['eight']);
  });

  it('is inclusive of the cutoff hour itself', () => {
    // 16:00 Warsaw must survive an "after 16:00" filter — the chip reads as
    // "from 16:00 onwards", so dropping a 16:00 screening would surprise.
    expect(filterEventsFromHour(events, 16).map((e) => e.id)).toContain('four');
  });

  it('drops events with unparseable start times', () => {
    expect(filterEventsFromHour([evt('not-a-date', 'bad')], 8)).toEqual([]);
  });
});

// Regression: events beyond the week used to fall through every branch and
// vanish. Because the pages only render their empty state when the *filtered*
// list is empty, a venue whose next event was further out rendered nothing at
// all — no rows, no explanation. Every Warsaw theatre looked broken in summer.
describe('bucketEvents — nothing this week (GOI-82)', () => {
  const now = new Date('2026-07-29T10:00:00.000Z');

  it('shows the nearest events instead of rendering nothing', () => {
    const autumn = evt('2026-09-12T18:00:00+02:00', 'sep');
    const buckets = bucketEvents([autumn], now);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.items.map((e) => e.id)).toEqual(['sep']);
    // A period, not a single date: "how far off is the programme?".
    expect(buckets[0]!.label).toBe('Later');
  });

  // The old rule stopped at the nearest day, which in a Warsaw summer meant a
  // single row on a page — that reads as breakage, not as a quiet season.
  it('widens past the nearest day when it has fewer than five rows', () => {
    const buckets = bucketEvents(
      [
        evt('2026-09-12T18:00:00+02:00', 'a'),
        evt('2026-09-12T20:30:00+02:00', 'b'),
        evt('2026-09-13T18:00:00+02:00', 'next-day'),
        evt('2026-10-01T18:00:00+02:00', 'october'),
      ],
      now,
    );
    expect(buckets.flatMap((b) => b.items.map((e) => e.id)))
      .toEqual(['a', 'b', 'next-day', 'october']);
  });

  it('stops once there is enough to read, rather than unrolling the season', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      evt(`2026-09-${String(12 + i).padStart(2, '0')}T18:00:00+02:00`, `e${i}`),
    );
    const buckets = bucketEvents(many, now);
    const shown = buckets.flatMap((b) => b.items);
    expect(shown.length).toBeGreaterThanOrEqual(FALLBACK_MIN_EVENTS);
    expect(shown.length).toBeLessThanOrEqual(FALLBACK_MAX_EVENTS);
  });

  // Stopping mid-evening would hide the 20:30 showing of something whose
  // 18:00 made the cut.
  it('never splits a day', () => {
    const events = [
      ...Array.from({ length: 4 }, (_, i) => evt(`2026-09-12T1${i}:00:00+02:00`, `d1-${i}`)),
      ...Array.from({ length: 4 }, (_, i) => evt(`2026-09-13T1${i}:00:00+02:00`, `d2-${i}`)),
    ];
    const shown = bucketEvents(events, now).flatMap((b) => b.items.map((e) => e.id));
    // Day one is 4 rows — under the minimum — so day two comes too, whole.
    expect(shown.filter((id) => id.startsWith('d2-'))).toHaveLength(4);
  });

  it('picks the nearest day in Warsaw terms', () => {
    // 22:30Z on the 11th is already 00:30 on the 12th in Warsaw.
    const buckets = bucketEvents(
      [evt('2026-09-11T22:30:00.000Z', 'past-midnight'), evt('2026-09-12T16:00:00.000Z', 'evening')],
      now,
    );
    expect(buckets.flatMap((b) => b.items.map((e) => e.id)))
      .toEqual(['past-midnight', 'evening']);
  });

  it('stays out of the way when the week has something', () => {
    // The listing is "what's on now"; a single show this week must not drag
    // the whole autumn programme in behind it.
    const buckets = bucketEvents(
      [evt('2026-07-31T18:00:00+02:00', 'this-week'), evt('2026-09-12T18:00:00+02:00', 'autumn')],
      now,
    );
    expect(buckets.map((b) => b.key)).toEqual(['thisWeek']);
    expect(buckets[0]!.items.map((e) => e.id)).toEqual(['this-week']);
  });

  it('returns nothing at all when there is genuinely nothing upcoming', () => {
    expect(bucketEvents([], now)).toEqual([]);
    expect(bucketEvents([evt('2026-07-01T18:00:00+02:00', 'past')], now)).toEqual([]);
  });
});

// GOI-53: museums publish runs, not showtimes. Their undated rows carry local
// midnight as a "no hour published" marker.
describe('all-day museum rows', () => {
  function exhibition(startsAt: string, opts: { id?: string; title?: string; venueId?: string } = {}): Event {
    return {
      ...evt(startsAt, opts.id ?? startsAt),
      category: 'exhibition',
      title: opts.title ?? 'Wystawa stała',
      venueId: opts.venueId ?? 'mnw',
    };
  }

  // Warsaw is UTC+2 in June, so local midnight on the 9th is 22:00Z on the 8th.
  const midnight9 = '2026-06-08T22:00:00.000Z';
  const midnight10 = '2026-06-09T22:00:00.000Z';
  const midnight11 = '2026-06-10T22:00:00.000Z';
  const now = new Date('2026-06-09T10:00:00.000Z'); // Tue 12:00 Warsaw

  it('recognises exactly-midnight exhibition rows, and only those', () => {
    expect(isAllDay(exhibition(midnight9))).toBe(true);
    // A genuinely timed museum row — an 11:00 guided tour — keeps its hour.
    expect(isAllDay(exhibition('2026-06-09T09:00:00.000Z'))).toBe(false);
    // Midnight alone isn't enough: a late-night gig is not an all-day run.
    expect(isAllDay(evt(midnight9))).toBe(false);
  });

  it('keeps a run visible for the whole day instead of expiring it at 00:00', () => {
    // The row for *today* is already hours in the past by lunchtime. Before
    // GOI-53 it was dropped and the museum surfaced under "Tomorrow".
    const buckets = bucketEvents([exhibition(midnight9), exhibition(midnight10)], now);
    expect(buckets.find((b) => b.key === 'today')?.items.map((e) => e.id)).toEqual([midnight9]);
  });

  it('drops a run that ended yesterday', () => {
    const yesterday = '2026-06-07T22:00:00.000Z'; // local midnight on the 8th
    expect(bucketEvents([exhibition(yesterday)], now)).toEqual([]);
  });

  it('never files an all-day run under "Starting soon"', () => {
    // 12:30 Warsaw is inside the 30-minute window, but nothing "starts" then.
    const buckets = bucketEvents([exhibition('2026-06-09T10:20:00.000Z', { id: 'timed' })], now);
    expect(buckets.find((b) => b.key === 'soon')?.items.map((e) => e.id)).toEqual(['timed']);

    const allDay = bucketEvents([exhibition(midnight9)], now);
    expect(allDay.find((b) => b.key === 'soon')).toBeUndefined();
    expect(allDay.find((b) => b.key === 'today')?.items).toHaveLength(1);
  });

  it('shows a three-month run once, not once per day', () => {
    const run = [
      exhibition(midnight9, { id: 'd1' }),
      exhibition(midnight10, { id: 'd2' }),
      exhibition(midnight11, { id: 'd3' }),
    ];
    const ids = bucketEvents(run, now).flatMap((b) => b.items.map((e) => e.id));
    expect(ids).toEqual(['d1']);
  });

  it('collapses titles that differ only in case, spacing or trailing punctuation', () => {
    const run = [
      exhibition(midnight9, { id: 'd1', title: 'Wystawa stała' }),
      exhibition(midnight10, { id: 'd2', title: 'WYSTAWA  STAŁA.' }),
    ];
    expect(dedupeAllDay(run).map((e) => e.id)).toEqual(['d1']);
  });

  it('keeps the same title at two museums — they are two things to go to', () => {
    const run = [
      exhibition(midnight9, { id: 'mnw', venueId: 'mnw' }),
      exhibition(midnight9, { id: 'polin', venueId: 'polin' }),
    ];
    expect(dedupeAllDay(run).map((e) => e.id)).toEqual(['mnw', 'polin']);
  });

  it('leaves a museum\'s timed tours alone, even repeated on one day', () => {
    const tours = [
      exhibition('2026-06-09T09:00:00.000Z', { id: 't11', title: 'Oprowadzanie' }),
      exhibition('2026-06-09T13:00:00.000Z', { id: 't15', title: 'Oprowadzanie' }),
    ];
    expect(dedupeAllDay(tours).map((e) => e.id)).toEqual(['t11', 't15']);
  });

  it('leaves films alone — repeat showings are the point', () => {
    const showings = [evt('2026-06-09T16:00:00.000Z', 'a'), evt('2026-06-09T19:00:00.000Z', 'b')];
    expect(dedupeAllDay(showings).map((e) => e.id)).toEqual(['a', 'b']);
  });
});

// ─── Exhibitions (GOI-67) ────────────────────────────────────────────────────

function exhibition(startsAt: string, endsAt: string | null, id = `x-${startsAt}`): Event {
  return { ...evt(startsAt, id), kind: 'exhibition', category: 'exhibition', endsAt };
}

describe('splitExhibitions', () => {
  it('separates runs from timed rows and sorts runs by closing date', () => {
    const late = exhibition('2026-06-01T00:00:00+02:00', '2026-11-30T00:00:00+01:00', 'late');
    const soon = exhibition('2026-06-01T00:00:00+02:00', '2026-09-14T00:00:00+02:00', 'soon');
    const film = evt('2026-06-08T18:00:00+02:00', 'film');

    const { timed, exhibitions } = splitExhibitions([late, film, soon]);
    expect(timed.map((e) => e.id)).toEqual(['film']);
    expect(exhibitions.map((e) => e.id)).toEqual(['soon', 'late']);
  });

  it('leaves a legacy all-day museum row in the buckets', () => {
    // No `kind`, no closing date: there is no range to print, so moving it to
    // a section headed by ranges would show it worse than it shows now.
    const legacy: Event = { ...evt('2026-06-08T00:00:00+02:00', 'legacy'), category: 'exhibition' };
    const { timed, exhibitions } = splitExhibitions([legacy]);
    expect(timed.map((e) => e.id)).toEqual(['legacy']);
    expect(exhibitions).toEqual([]);
  });
});

describe('exhibitionCoversDay', () => {
  const run = { startsAt: '2026-06-12T00:00:00+02:00', endsAt: '2026-09-14T00:00:00+02:00' };

  it('covers a day inside the run', () => {
    expect(exhibitionCoversDay(run, '2026-08-11')).toBe(true);
  });

  it('is inclusive at both ends', () => {
    expect(exhibitionCoversDay(run, '2026-06-12')).toBe(true);
    expect(exhibitionCoversDay(run, '2026-09-14')).toBe(true);
  });

  it('excludes the days either side', () => {
    expect(exhibitionCoversDay(run, '2026-06-11')).toBe(false);
    expect(exhibitionCoversDay(run, '2026-09-15')).toBe(false);
  });

  it('runs on indefinitely when no closing date was published', () => {
    expect(exhibitionCoversDay({ startsAt: run.startsAt, endsAt: null }, '2027-01-01')).toBe(true);
  });
});

describe('filterEventsByDay — exhibitions', () => {
  const run = exhibition('2026-06-12T00:00:00+02:00', '2026-09-14T00:00:00+02:00', 'run');

  it('keeps a run on any day it covers, not just its opening day', () => {
    expect(filterEventsByDay([run], '2026-08-11').map((e) => e.id)).toEqual(['run']);
  });

  it('drops it outside the run', () => {
    expect(filterEventsByDay([run], '2026-09-20')).toEqual([]);
  });
});

describe('filterEventsFromHour — exhibitions', () => {
  it('removes runs entirely: a time filter is a question about scheduling', () => {
    const run = exhibition('2026-06-12T00:00:00+02:00', '2026-09-14T00:00:00+02:00', 'run');
    const evening = evt('2026-06-12T19:00:00+02:00', 'evening');
    expect(filterEventsFromHour([run, evening], 18).map((e) => e.id)).toEqual(['evening']);
    // No filter, no removal.
    expect(filterEventsFromHour([run, evening], null).map((e) => e.id)).toEqual(['run', 'evening']);
  });
});

describe('bucketEvents — exhibitions', () => {
  it('never puts a run in a time bucket', () => {
    const now = new Date('2026-06-08T14:00:00.000Z');
    const run = exhibition('2026-06-01T00:00:00+02:00', '2026-09-14T00:00:00+02:00', 'run');
    const film = evt('2026-06-08T14:25:00.000Z', 'in25');
    const buckets = bucketEvents([run, film], now);
    expect(buckets.flatMap((b) => b.items.map((e) => e.id))).toEqual(['in25']);
  });
});


describe('periodKey (GOI-82)', () => {
  // Wednesday 29 July 2026; that Warsaw week runs Mon 27 Jul – Sun 2 Aug.
  const now = new Date('2026-07-29T10:00:00.000Z');

  it('names the rest of the current week', () => {
    expect(periodKey('2026-08-02T18:00:00+02:00', now)).toBe('thisWeek');
  });

  it('names the following week', () => {
    expect(periodKey('2026-08-03T18:00:00+02:00', now)).toBe('nextWeek');
    expect(periodKey('2026-08-09T18:00:00+02:00', now)).toBe('nextWeek');
  });

  // The finer answer wins: eight days out is "next week", not "this month".
  it('prefers a week label over a month one', () => {
    expect(periodKey('2026-08-04T18:00:00+02:00', now)).toBe('nextWeek');
  });

  it('names the rest of this month, then next month', () => {
    expect(periodKey('2026-07-31T18:00:00+02:00', now)).toBe('thisWeek');
    expect(periodKey('2026-08-20T18:00:00+02:00', now)).toBe('nextMonth');
  });

  it('falls back to "later" beyond next month', () => {
    expect(periodKey('2026-10-01T18:00:00+02:00', now)).toBe('later');
  });

  it('rolls the month over a year boundary', () => {
    const december = new Date('2026-12-15T10:00:00.000Z');
    expect(periodKey('2027-01-20T18:00:00+01:00', december)).toBe('nextMonth');
  });

  it('does not throw on an unparseable date', () => {
    expect(periodKey('not-a-date', now)).toBe('later');
  });
});


// ─── The day filter's scopes (GOI-88) ────────────────────────────────────────

describe('dayFilterRange', () => {
  // Wed 8 Jul 2026, 14:00 Warsaw.
  const now = new Date('2026-07-08T12:00:00.000Z');

  it('is null for "any day"', () => {
    expect(dayFilterRange(null, now)).toBeNull();
  });

  it('makes a single day a one-day window', () => {
    expect(dayFilterRange('2026-07-11', now)).toEqual({
      fromDay: '2026-07-11',
      toDay: '2026-07-11',
    });
  });

  it('makes "this week" today plus six more days — the bucket\'s own window', () => {
    expect(dayFilterRange(WEEK_FILTER, now)).toEqual({
      fromDay: '2026-07-08',
      toDay: '2026-07-14',
    });
  });

  it('anchors "this week" on the Warsaw day, not the UTC one', () => {
    // 22:30 UTC on Wed 8 Jul is 00:30 Thu 9 Jul in Warsaw.
    const pastMidnight = new Date('2026-07-08T22:30:00.000Z');
    expect(dayFilterRange(WEEK_FILTER, pastMidnight)).toEqual({
      fromDay: '2026-07-09',
      toDay: '2026-07-15',
    });
  });
});

describe('filterEventsByDay — "this week"', () => {
  const now = new Date('2026-07-08T12:00:00.000Z'); // Wed 8 Jul, 14:00 Warsaw
  const inside = evt('2026-07-14T18:00:00.000Z', 'last-day'); // Tue 14 Jul
  const outside = evt('2026-07-15T18:00:00.000Z', 'day-eight'); // Wed 15 Jul
  const today = evt('2026-07-08T18:00:00.000Z', 'today');

  it('keeps every day of the seven-day window and nothing past it', () => {
    expect(filterEventsByDay([today, inside, outside], WEEK_FILTER, now).map((e) => e.id))
      .toEqual(['today', 'last-day']);
  });

  it('keeps an exhibition whose run overlaps the window', () => {
    const run = exhibition('2026-07-13T00:00:00+02:00', '2026-08-30T00:00:00+02:00', 'run');
    const over = exhibition('2026-05-01T00:00:00+02:00', '2026-07-01T00:00:00+02:00', 'closed');
    expect(filterEventsByDay([run, over], WEEK_FILTER, now).map((e) => e.id)).toEqual(['run']);
  });
});

describe('visibleEvents', () => {
  // 20:00 Warsaw — the hour at which "Today" used to render a blank page.
  const now = new Date('2026-07-08T18:00:00.000Z');

  it('drops timed events that have already started', () => {
    const over = evt('2026-07-08T16:00:00.000Z', 'over');
    const later = evt('2026-07-08T19:00:00.000Z', 'later');
    expect(visibleEvents([over, later], now).map((e) => e.id)).toEqual(['later']);
  });

  it('keeps an all-day row until its own day is out', () => {
    // A legacy museum row: midnight placeholder on today's date.
    const allDay = { ...evt('2026-07-07T22:00:00.000Z', 'all-day'), category: 'exhibition' as const };
    expect(visibleEvents([allDay], now).map((e) => e.id)).toEqual(['all-day']);
  });

  it('keeps a running exhibition and drops one that has closed', () => {
    const running = exhibition('2026-06-01T00:00:00+02:00', '2026-09-01T00:00:00+02:00', 'running');
    const closed = exhibition('2026-05-01T00:00:00+02:00', '2026-07-07T00:00:00+02:00', 'closed');
    expect(visibleEvents([running, closed], now).map((e) => e.id)).toEqual(['running']);
  });
});

describe('nextEventStart', () => {
  const now = new Date('2026-07-08T18:00:00.000Z');

  it('names the soonest event still to come', () => {
    const over = evt('2026-07-08T16:00:00.000Z', 'over');
    const soon = evt('2026-07-11T16:00:00.000Z', 'soon');
    const later = evt('2026-07-19T16:00:00.000Z', 'later');
    expect(nextEventStart([later, over, soon], now)).toBe(soon.startsAt);
  });

  it('has no date to give when the only thing on is a run', () => {
    const run = exhibition('2026-06-01T00:00:00+02:00', '2026-09-01T00:00:00+02:00', 'run');
    expect(nextEventStart([run], now)).toBeNull();
  });

  it('is null for an empty listing', () => {
    expect(nextEventStart([], now)).toBeNull();
  });
});

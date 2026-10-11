import { describe, it, expect } from 'vitest';
import type { Event } from '@afisz/shared';
import {
  CLASH_MINUTES, chooseLayout, dayPart, listingGroups, minutesIntoDay, planPoster,
  posterCategories, type PosterCategory,
} from './newsletter-poster.js';
import type { BriefSection } from './newsletter-render.js';
import {
  CINEMA, EXHIBITION, MUSIC, SAMPLE_NOW, SAMPLE_SAVED, SAMPLE_SECTIONS,
} from '../__tests__/fixtures/daily-poster-day.js';

const DAY = '2026-09-04';

let n = 0;
/** A timed event on the sample day at Warsaw `hh:mm`. */
const at = (hhmm: string, over: Partial<Event> = {}): Event => ({
  ...CINEMA[0]!,
  id: `t${++n}`,
  title: `Event ${n}`,
  description: null,
  startsAt: new Date(`2026-09-04T${hhmm}:00+02:00`).toISOString(),
  ...over,
});

const section = (category: string, events: Event[]): BriefSection =>
  ({ category, windowDays: 1, detail: 'full', events });

describe('planPoster on the design’s own sample day', () => {
  const plan = planPoster({ sections: SAMPLE_SECTIONS, savedEventIds: SAMPLE_SAVED, now: SAMPLE_NOW });

  it('counts the day and the places as the masthead prints them', () => {
    expect(plan.day).toBe(DAY);
    expect(plan.eventCount).toBe(31);
    expect(plan.placeCount).toBe(8);
  });

  it('heroes the best thing tonight, as the mock does', () => {
    expect(plan.hero?.title).toBe('Sirât');
    expect(plan.heroTonight).toBe(true);
  });

  it('lists today’s saved events, and keeps them out of the picks', () => {
    expect(plan.saved.map((e) => e.id)).toEqual(SAMPLE_SAVED.slice().sort((a, b) => {
      const ea = [...CINEMA, ...EXHIBITION, ...MUSIC].find((e) => e.id === a)!;
      const eb = [...CINEMA, ...EXHIBITION, ...MUSIC].find((e) => e.id === b)!;
      return ea.startsAt.localeCompare(eb.startsAt);
    }));
    for (const id of SAMPLE_SAVED) expect(plan.picks.has(id)).toBe(false);
  });

  it('spreads three more across the categories, the day, and clear of the hero', () => {
    expect(plan.more).toHaveLength(3);
    const categories = plan.more.map((e) => plan.categoryOf.get(e.id)!.key);
    expect(new Set(categories)).toEqual(new Set(['cinema', 'exhibition', 'music']));
    // Sorted by start.
    expect(plan.more.map((e) => e.startsAt)).toEqual([...plan.more.map((e) => e.startsAt)].sort());
    // None asks the reader to be somewhere else while the hero is on.
    for (const e of plan.more) {
      expect(Math.abs(minutesIntoDay(e.startsAt, DAY) - minutesIntoDay(plan.hero!.startsAt, DAY)))
        .toBeGreaterThanOrEqual(CLASH_MINUTES);
    }
    expect(plan.picks).toEqual(new Set([plan.hero!.id, ...plan.more.map((e) => e.id)]));
  });

  it('bands cinema, cuts exhibitions into parts of the day, and merges music into them', () => {
    expect(plan.groups.map((g) => [g.layout, g.categories.map((c) => c.label)])).toEqual([
      ['bands', ['Cinema']],
      ['day', ['Exhibition', 'Music']],
    ]);
  });
});

describe('the hero', () => {
  it('skips an event the reader already saved', () => {
    const sirat = CINEMA.find((e) => e.title === 'Sirât')!;
    const plan = planPoster({
      sections: SAMPLE_SECTIONS, savedEventIds: [sirat.id], now: SAMPLE_NOW,
    });
    expect(plan.hero?.id).not.toBe(sirat.id);
    expect(plan.saved.map((e) => e.id)).toEqual([sirat.id]);
  });

  it('falls back to the best of the day when nothing starts at 18:00 or later', () => {
    const plan = planPoster({
      sections: [section('cinema', [at('11:00'), at('14:00', { description: 'Worth it.' })])],
      now: SAMPLE_NOW,
    });
    expect(plan.hero?.description).toBe('Worth it.');
    expect(plan.heroTonight).toBe(false);
  });

  it('prefers an event with something to say about it over a later one without', () => {
    const plan = planPoster({
      sections: [section('cinema', [at('23:00'), at('19:00', { description: 'Said.' })])],
      now: SAMPLE_NOW,
    });
    expect(plan.hero?.description).toBe('Said.');
  });

  it('is absent rather than repeated when everything today is saved', () => {
    const events = [at('19:00'), at('20:00')];
    const plan = planPoster({
      sections: [section('cinema', events)], savedEventIds: events.map((e) => e.id), now: SAMPLE_NOW,
    });
    expect(plan.hero).toBeNull();
    expect(plan.more).toEqual([]);
    expect(plan.saved).toHaveLength(2);
  });
});

describe('want to go', () => {
  it('shows three and counts the rest', () => {
    const events = ['10:00', '11:00', '12:00', '13:00', '14:00'].map((t) => at(t));
    const plan = planPoster({
      sections: [section('cinema', events)], savedEventIds: events.map((e) => e.id), now: SAMPLE_NOW,
    });
    expect(plan.saved.map((e) => e.id)).toEqual(events.slice(0, 3).map((e) => e.id));
    expect(plan.savedOverflow).toBe(2);
  });

  it('ignores saved events that are not in today’s issue', () => {
    const plan = planPoster({
      sections: [section('cinema', [at('19:00')])], savedEventIds: ['elsewhere'], now: SAMPLE_NOW,
    });
    expect(plan.saved).toEqual([]);
    expect(plan.savedOverflow).toBe(0);
  });
});

describe('categories', () => {
  it('keeps the reader’s order, and prints a tag as they typed it', () => {
    const cats = posterCategories(
      [section('arthouse Kino', [at('20:00')]), section('cinema', [at('19:00')])], DAY,
    );
    expect(cats.map((c) => c.label)).toEqual(['arthouse Kino', 'Cinema']);
  });

  it('splits a rule-less brief by the events’ own categories', () => {
    const cats = posterCategories(
      [section('', [at('20:00', { category: 'music' }), at('19:00'), at('10:00', { category: 'exhibition' })])],
      DAY,
    );
    expect(cats.map((c) => c.key)).toEqual(['cinema', 'music', 'exhibition']);
  });
});

describe('layout choice', () => {
  it('bands a category that is mostly timed within six hours', () => {
    expect(chooseLayout([at('18:00'), at('20:00'), at('23:59')], DAY)).toBe('bands');
  });

  it('cuts the day when the times spread wider than six hours', () => {
    expect(chooseLayout([at('10:00'), at('20:00')], DAY)).toBe('day');
  });

  it('cuts the day when too many events are all-day', () => {
    const allDay = { ...EXHIBITION[0]! };
    expect(chooseLayout([at('19:00'), allDay], DAY)).toBe('day');
  });
});

describe('merging small categories', () => {
  const cat = (key: string, size: number, layout: 'bands' | 'day'): PosterCategory => ({
    key, label: key, noun: { one: 'e', many: 'es', total: 'es' }, layout,
    events: Array.from({ length: size }, () => at('19:00')),
  });

  it('rides a small category on the previous part-of-day sheet', () => {
    const groups = listingGroups([cat('a', 9, 'day'), cat('b', 2, 'bands')]);
    expect(groups.map((g) => g.categories.map((c) => c.key))).toEqual([['a', 'b']]);
  });

  it('holds one for the next part-of-day sheet when none came before', () => {
    const groups = listingGroups([cat('s', 3, 'bands'), cat('c', 9, 'bands'), cat('d', 5, 'day')]);
    expect(groups.map((g) => g.categories.map((c) => c.key))).toEqual([['c'], ['d', 's']]);
  });

  it('gives it its own sheet when there is nothing to merge into', () => {
    const groups = listingGroups([cat('c', 9, 'bands'), cat('s', 2, 'bands')]);
    expect(groups.map((g) => g.categories.map((c) => c.key))).toEqual([['c'], ['s']]);
  });
});

describe('the day after midnight', () => {
  it('counts a 00:30 showing as tonight, not this morning', () => {
    const late = { ...at('20:00'), startsAt: '2026-09-04T22:30:00.000Z' }; // 00:30 on the 5th
    expect(minutesIntoDay(late.startsAt, DAY)).toBe(24 * 60 + 30);
    expect(dayPart(late, DAY)).toBe('evening');
  });
});

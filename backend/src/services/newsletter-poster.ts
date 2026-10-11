import type { Event } from '@afisz/shared';
import { isExhibition } from '@afisz/shared';
import type { BriefSection } from './newsletter-render.js';

/**
 * What goes where on the daily poster (the "AFISZ.KA Daily" handoff).
 *
 * A daily issue is drawn as a set of A4 sheets: a front page carrying one hero
 * pick for tonight, three more picks spread across the day and the reader's own
 * saved events for today, followed by the complete listing one category per
 * sheet. This module decides all of that and draws nothing — the renderer in
 * `newsletter-poster-pdf.ts` only lays out the plan it is handed, so every
 * editorial rule here is testable without reading a PDF back.
 *
 * Each event appears once on the front and once in the listing. The listing
 * tints the picks (hero and three more) so the two visibly agree; saved events
 * are not tinted, because the front already says the reader chose them.
 */

const TZ = 'Europe/Warsaw';

/** A category's own words: its heading, and what one of its events is called. */
export interface PosterNoun {
  one: string;
  many: string;
  /** What the listing header counts — "15 screenings". */
  total: string;
}

/** One category as the poster lists it. */
export interface PosterCategory {
  /** Lower-cased category or tag, for grouping. */
  key: string;
  /** The heading, in English for a built-in and as typed for a reader's tag. */
  label: string;
  noun: PosterNoun;
  /** Sorted by start, all-day first. */
  events: Event[];
  layout: 'bands' | 'day';
}

/**
 * One run of listing sheets. A time-band group always holds one category; a
 * part-of-day group may carry small categories merged into it, and names the
 * first as its own.
 */
export interface ListingGroup {
  layout: 'bands' | 'day';
  categories: PosterCategory[];
}

export interface PosterPlan {
  /** The day the issue covers, as the Warsaw date `YYYY-MM-DD`. */
  day: string;
  eventCount: number;
  placeCount: number;
  hero: Event | null;
  /** True when the hero starts at 18:00 or later ("Tonight — the one"). */
  heroTonight: boolean;
  /** Up to three, sorted by start. */
  more: Event[];
  /** Saved events on today, at most `SAVED_ON_FRONT`, sorted by start. */
  saved: Event[];
  /** Saved events today that did not fit on the front. */
  savedOverflow: number;
  /** Ids of the hero and the three more — tinted in the listing. */
  picks: Set<string>;
  groups: ListingGroup[];
  /** Which category each event is listed under. */
  categoryOf: Map<string, PosterCategory>;
}

/** The front page shows at most this many saved events before "+N more". */
export const SAVED_ON_FRONT = 3;
/** "Three more for today". */
export const MORE_COUNT = 3;
/** Categories this small ride along on the previous part-of-day sheet. */
export const MERGE_AT_MOST = 3;
/** The hour "tonight" starts, for the hero. */
export const TONIGHT_HOUR = 18;

const BUILT_IN: Record<string, { label: string; noun: PosterNoun }> = {
  cinema: { label: 'Cinema', noun: { one: 'film', many: 'films', total: 'screenings' } },
  exhibition: { label: 'Exhibition', noun: { one: 'event', many: 'events', total: 'events' } },
  music: { label: 'Music', noun: { one: 'concert', many: 'concerts', total: 'concerts' } },
  theatre: { label: 'Theatre', noun: { one: 'performance', many: 'performances', total: 'performances' } },
  comedy: { label: 'Comedy', noun: { one: 'show', many: 'shows', total: 'shows' } },
  other: { label: 'Other', noun: { one: 'event', many: 'events', total: 'events' } },
};

/** The order built-ins take when the reader set no rules to order them by. */
const BUILT_IN_ORDER = ['cinema', 'theatre', 'music', 'exhibition', 'comedy', 'other'];

const GENERIC_NOUN: PosterNoun = { one: 'event', many: 'events', total: 'events' };

function describeCategory(raw: string): { key: string; label: string; noun: PosterNoun } {
  const key = raw.trim().toLowerCase();
  const known = BUILT_IN[key];
  // A reader's own tag is their word for the thing and is printed as typed.
  return known ? { key, ...known } : { key, label: raw.trim(), noun: GENERIC_NOUN };
}

/** `2026-09-04` in Warsaw. */
export function warsawDay(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

/** Minutes past Warsaw midnight on the issue's own day, so a 00:30 showing
 *  after a Friday evening sorts and buckets as Friday night, not Friday dawn. */
export function minutesIntoDay(iso: string, day: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const later = warsawDay(iso) > day ? 24 * 60 : 0;
  return later + h * 60 + m;
}

/** An event without a clock time: an exhibition, on all day. */
export function isAllDay(event: Event): boolean {
  return isExhibition(event);
}

/** Sort key: all-day first, then by the actual instant. */
function byStart(a: Event, b: Event): number {
  const ad = isAllDay(a);
  const bd = isAllDay(b);
  if (ad !== bd) return ad ? -1 : 1;
  if (ad && bd) return a.title.localeCompare(b.title, 'pl');
  return a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title, 'pl');
}

/**
 * Editorial rank, best first. There is no popularity score in the data, so
 * this is the handoff's fallback: an event with a description beats one
 * without (there is something to say about it), then the later start wins.
 */
function byRank(a: Event, b: Event): number {
  const ad = a.description?.trim() ? 1 : 0;
  const bd = b.description?.trim() ? 1 : 0;
  if (ad !== bd) return bd - ad;
  const at = isAllDay(a);
  const bt = isAllDay(b);
  // A timed event outranks an all-day one: it is a thing to go to *tonight*.
  if (at !== bt) return at ? 1 : -1;
  return b.startsAt.localeCompare(a.startsAt) || a.id.localeCompare(b.id);
}

export type DayPart = 'allday' | 'morning' | 'afternoon' | 'evening';

/** Which part-of-day bucket an event falls in. */
export function dayPart(event: Event, day: string): DayPart {
  if (isAllDay(event)) return 'allday';
  const minutes = minutesIntoDay(event.startsAt, day);
  if (minutes < 13 * 60) return 'morning';
  if (minutes < 18 * 60) return 'afternoon';
  return 'evening';
}

/**
 * The poster's categories, in the reader's order.
 *
 * Sections already are the reader's categories in their chosen order, with
 * every event placed in the first rule that caught it. A config with no rules
 * arrives as one unnamed section; that is split by the events' own category so
 * the listing still gets its one-category-per-sheet shape.
 */
export function posterCategories(sections: BriefSection[], day: string): PosterCategory[] {
  const out = new Map<string, PosterCategory>();
  const add = (raw: string, events: Event[]) => {
    const { key, label, noun } = describeCategory(raw);
    const existing = out.get(key);
    if (existing) existing.events.push(...events);
    else out.set(key, { key, label, noun, events: [...events], layout: 'bands' });
  };

  for (const section of sections) {
    if (section.category.trim()) {
      add(section.category, section.events);
      continue;
    }
    const byBuiltIn = new Map<string, Event[]>();
    for (const e of section.events) {
      byBuiltIn.set(e.category, [...(byBuiltIn.get(e.category) ?? []), e]);
    }
    for (const key of [...byBuiltIn.keys()].sort(
      (a, b) => BUILT_IN_ORDER.indexOf(a) - BUILT_IN_ORDER.indexOf(b),
    )) {
      add(key, byBuiltIn.get(key)!);
    }
  }

  const categories = [...out.values()].filter((c) => c.events.length > 0);
  for (const c of categories) {
    c.events.sort(byStart);
    c.layout = chooseLayout(c.events, day);
  }
  return categories;
}

/**
 * Time bands when at least 70% of a category's events have a start time and
 * those times sit inside six hours — a cinema evening. Otherwise the day is cut
 * into parts, which is what a museum's scatter of tours and all-day shows needs.
 */
export function chooseLayout(events: Event[], day: string): 'bands' | 'day' {
  if (events.length === 0) return 'day';
  const timed = events.filter((e) => !isAllDay(e));
  if (timed.length / events.length < 0.7) return 'day';
  const minutes = timed.map((e) => minutesIntoDay(e.startsAt, day));
  return Math.max(...minutes) - Math.min(...minutes) <= 6 * 60 ? 'bands' : 'day';
}

/**
 * Sheets for the listing: one group per category, except that a category of
 * three events or fewer joins the previous part-of-day group rather than
 * getting a page to itself. With no earlier part-of-day group it waits for the
 * next one; with none at all it keeps its own sheet.
 */
export function listingGroups(categories: PosterCategory[]): ListingGroup[] {
  const groups: ListingGroup[] = [];
  let pending: PosterCategory[] = [];
  let lastDay: ListingGroup | null = null;

  for (const c of categories) {
    const small = c.events.length <= MERGE_AT_MOST;
    if (small && lastDay) {
      lastDay.categories.push(c);
      continue;
    }
    if (small) {
      pending.push(c);
      continue;
    }
    const group: ListingGroup = { layout: c.layout, categories: [c] };
    groups.push(group);
    if (c.layout === 'day') {
      lastDay = group;
      group.categories.push(...pending);
      pending = [];
    }
  }
  // Nothing to merge into: each keeps its own sheet, in its own layout.
  for (const c of pending) groups.push({ layout: c.layout, categories: [c] });
  return groups;
}

/**
 * Tonight's hero (2.3): the best event starting at 18:00 or later that the
 * reader has not already saved. With nothing that late, the best of the day.
 */
export function chooseHero(events: Event[], saved: Set<string>, day: string): Event | null {
  const open = events.filter((e) => !saved.has(e.id));
  const tonight = open.filter(
    (e) => !isAllDay(e) && minutesIntoDay(e.startsAt, day) >= TONIGHT_HOUR * 60,
  );
  const pool = tonight.length > 0 ? tonight : open;
  return [...pool].sort(byRank)[0] ?? null;
}

/** Two picks closer than this would ask the reader to be in two places. */
export const CLASH_MINUTES = 90;

/**
 * Three more (2.4): round-robin across the reader's categories in their order,
 * taking the best remaining event from each. Where it can, a pick covers a
 * part of the day nothing chosen so far covers, and failing that, starts well
 * clear of the ones already chosen — so the three read as a day rather than as
 * three things at nine, and none of them is on at the same time as the hero.
 */
export function chooseMore(
  categories: PosterCategory[],
  exclude: Set<string>,
  hero: Event | null,
  day: string,
): Event[] {
  const pools = categories.map((c) =>
    c.events.filter((e) => !exclude.has(e.id)).sort(byRank),
  );
  const covered = new Set<DayPart>(hero ? [dayPart(hero, day)] : []);
  const chosen: Event[] = [];
  const taken: Event[] = hero ? [hero] : [];
  const clear = (e: Event) => isAllDay(e) || taken.every((o) => isAllDay(o)
    || Math.abs(minutesIntoDay(e.startsAt, day) - minutesIntoDay(o.startsAt, day)) >= CLASH_MINUTES);

  let progressed = true;
  while (chosen.length < MORE_COUNT && progressed) {
    progressed = false;
    for (const pool of pools) {
      if (chosen.length >= MORE_COUNT) break;
      if (pool.length === 0) continue;
      // Pools are ranked, so the first match at each tier is the best of it.
      const tiers = [
        (e: Event) => !covered.has(dayPart(e, day)) && clear(e),
        (e: Event) => !covered.has(dayPart(e, day)),
        clear,
      ];
      const at = tiers.map((ok) => pool.findIndex(ok)).find((i) => i !== -1) ?? 0;
      const [pick] = pool.splice(at, 1);
      chosen.push(pick!);
      taken.push(pick!);
      covered.add(dayPart(pick!, day));
      progressed = true;
    }
  }
  return chosen.sort(byStart);
}

/** Build the whole plan for one daily issue. */
export function planPoster(input: {
  sections: BriefSection[];
  savedEventIds?: Iterable<string>;
  now: Date;
}): PosterPlan {
  const day = warsawDay(input.now);
  const categories = posterCategories(input.sections, day);
  const events = categories.flatMap((c) => c.events);
  const categoryOf = new Map<string, PosterCategory>();
  for (const c of categories) for (const e of c.events) categoryOf.set(e.id, c);

  const savedIds = new Set(input.savedEventIds ?? []);
  // Only today's saved events, and only those in this issue — the same event
  // must be on the front and in the listing, or the two stop agreeing.
  const savedToday = events.filter((e) => savedIds.has(e.id)).sort(byStart);
  const savedSet = new Set(savedToday.map((e) => e.id));

  const hero = chooseHero(events, savedSet, day);
  const exclude = new Set([...savedSet, ...(hero ? [hero.id] : [])]);
  const more = chooseMore(categories, exclude, hero, day);

  return {
    day,
    eventCount: events.length,
    placeCount: new Set(events.map((e) => e.venueId)).size,
    hero,
    heroTonight: !!hero && !isAllDay(hero)
      && minutesIntoDay(hero.startsAt, day) >= TONIGHT_HOUR * 60,
    more,
    saved: savedToday.slice(0, SAVED_ON_FRONT),
    savedOverflow: Math.max(0, savedToday.length - SAVED_ON_FRONT),
    picks: new Set([...(hero ? [hero.id] : []), ...more.map((e) => e.id)]),
    groups: listingGroups(categories),
    categoryOf,
  };
}

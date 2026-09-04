import type {
  Category, Event, Festival, NewsletterCategoryRule, NewsletterDetail, NewsletterFrequency,
  NewsletterRuleCadence, NewsletterSendCadence,
} from '@afisz/shared';
import {
  deliversByEmail, deliversToDrive, deriveWindow, festivalsAtVenues, isExhibition,
  sendCadenceDays, timeFilterHour,
} from '@afisz/shared';
import { listFestivals } from '../data/festivals.js';
import { renderBriefHtml } from './newsletter-render.js';
import { defaultEventStore, FEED_CATEGORIES, type EventStore } from './event-store.js';
import { defaultUserVenueStore, type UserVenue, type UserVenueStore } from './user-venue-store.js';
import { newsletterFromEmail, sendEmail } from './email.js';
import { defaultNewsletterStore, SENT_EVENT_RETENTION_DAYS, type NewsletterStore, type NewsletterSubscription } from './newsletter-store.js';
import { defaultWantToGoStore, type WantToGoStore } from './want-to-go-store.js';
import {
  applyChangeDedup, applyQueueDedup, changeState, isEmptySection, isUrgent, queueCandidates,
  statesToRecord, urgentSendAllowed, type QueuedChange, type WantToGoSection,
} from './want-to-go-queue.js';
import { deliverBriefToDrives, type DeliverOptions, type DriveDeliveryOutcome } from './drive-delivery.js';
import { lastWarsawTimeAtOrBefore, warsawWeekday } from './scheduler.js';
import { env } from '../config.js';

const TZ = 'Europe/Warsaw';

// Newsletter briefs (GOI-8): a daily/weekly email of upcoming events at the
// venues the user picked, optionally narrowed to a time-of-day window
// ("Kino Muranów and Kinoteka every day, everything after 6 pm").

/**
 * How far ahead a whole newsletter looks, from its send cadence alone.
 *
 * A *section*'s window is no longer this (GOI-100): it is derived from the
 * send cadence and the rule's own cadence together, by `deriveWindow`. This
 * remains for the cases where there is no rule to derive from — the subject
 * line, and a config whose rules are all switched off.
 */
export function briefWindowDays(frequency: NewsletterFrequency): number {
  return sendCadenceDays(frequency);
}

/**
 * How far ahead the *fetch* has to reach for one config: the widest window any
 * of its sections can ask for.
 *
 * Not `briefWindowDays(plannedFrequency(sub))`, which is what both callers used
 * to pass. That collapses the config to a cadence first, and a cadence tops out
 * at 30 days — so a rule with `lookaheadDays` beyond a month (the schema allows
 * 90) had its section built from a 30-day fetch and silently lost everything
 * past day 30. The section still claimed the wider window in the subject line
 * and the PDF, which made the loss invisible: a "next 60 days" theatre section
 * that stopped at 30 looked like a quiet two months rather than a truncated
 * query.
 *
 * `buildBriefSections` filters by each section's own window afterwards, so
 * fetching wide costs nothing but the rows.
 */
export function briefFetchWindowDays(
  sub: { sendCadence: NewsletterSendCadence; categoryRules: NewsletterCategoryRule[] },
  now: Date = new Date(),
): number {
  return sub.categoryRules.reduce(
    (widest, rule) => Math.max(widest, deriveWindowDays(sub.sendCadence, rule, now)),
    // A config with no rules is one section on the send cadence — the floor
    // here rather than a special case, so an all-monthly-rules config cannot
    // come out narrower than the issue it rides in.
    sendCadenceDays(sub.sendCadence),
  );
}

/** Warsaw wall-clock hour of an ISO instant. */
function warsawHour(iso: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })
    .format(new Date(iso));
  return Number(h) % 24;
}

/** The subset of a subscription that decides what lands in a brief. Written
 *  out (rather than Pick'd) so callers holding freshly-parsed input, where the
 *  optional narrowing fields may be absent, can pass it straight through. */
export interface BriefScope {
  /**
   * How far ahead this selection reaches, in days. A number rather than a
   * cadence since GOI-100: a section's window is derived from two cadences at
   * once and an optional override, so there is no single frequency that names
   * it.
   */
  windowDays: number;
  /** The venues the brief covers. Already narrowed by the chosen tags — see
   *  `resolveBriefVenueIds`, which is what turns tags into venue ids. */
  venueIds: string[];
  afterHour?: number | null;
  beforeHour?: number | null;
}

/**
 * Which events belong in a brief: within the window, at one of the chosen
 * venues (empty selection = all), inside the after/before-hour window.
 *
 * An exhibition is selected by a different rule (GOI-110). `startsAt` on a run
 * is its opening day, not a showtime (GOI-67), so the two tests this applies to
 * a screening both misfire on it: "starts in the future" hides every exhibition
 * the morning after it opens, and the hour filters hide it always, since a run
 * is stored at local midnight and no reader asks for events before 8 am. The
 * query layer already selects a run by its closing date — this is the same rule
 * applied a second time, here, where the section is actually built. Without it
 * `listUpcoming` returned the exhibitions and this dropped them again, which is
 * why a museums section could only ever show a show that had not opened yet.
 */
export function selectBriefEvents(
  events: Event[],
  sub: BriefScope,
  now: Date = new Date(),
): Event[] {
  const horizon = new Date(now.getTime() + sub.windowDays * 24 * 3_600_000);
  return byStartTime(events.filter((e) => {
    if (sub.venueIds.length > 0 && !sub.venueIds.includes(e.venueId)) return false;
    const starts = new Date(e.startsAt);
    if (starts > horizon) return false;
    if (isExhibition(e)) {
      // On today if it has not closed yet. No end date means an open-ended run
      // — on until somebody says otherwise, which is the honest reading.
      return e.endsAt == null || new Date(e.endsAt) >= now;
    }
    if (starts < now) return false;
    const hour = warsawHour(e.startsAt);
    if (sub.afterHour != null && hour < sub.afterHour) return false;
    if (sub.beforeHour != null && hour >= sub.beforeHour) return false;
    return true;
  }));
}

/**
 * Chronological, earliest first, with a stable tie-break (GOI-121).
 *
 * A brief was only ever *incidentally* in time order: this is a filter over
 * whatever the fetch handed it, and both the wide query and the per-rule
 * top-ups happen to order by start time — so nothing here guaranteed it, and a
 * section came out in whatever order its rows arrived in. The rendered list
 * survived on `groupPicks` re-sorting downstream, which left everything else
 * built from a section — the preview's event list, anything a later section
 * layout wants to group — carrying the fetch's order rather than the reader's.
 *
 * Stated here, once, so the guarantee belongs to the brief rather than to one
 * renderer. Titles break a tie so two events at the same minute do not swap
 * places between the email and the PDF.
 */
export function byStartTime(events: Event[]): Event[] {
  return [...events].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title),
  );
}

/**
 * How far ahead the festival band looks for one that has not opened yet.
 *
 * A festival is the one thing in a brief you have to act on *before* it starts:
 * the good screenings sell out in the first day of sales, so a band that waits
 * for opening night tells you on the morning it stops being useful. Deliberately
 * wider than a weekly issue's own window — on 3 September a weekly brief covered
 * nothing but the week, and the festival eleven days out went unmentioned in
 * every issue until the one printed after it began.
 */
export const FESTIVAL_LOOKAHEAD_DAYS = 30;

/** Enough to say what is on; past that a busy autumn pushes the listings off
 *  the first screen, and the band stops being a headline. */
const MAX_BRIEF_FESTIVALS = 3;

/**
 * The festivals the brief's band calls out: on now, or opening soon (GOI-110).
 *
 * Ongoing first — `listFestivals` orders by start date and has already dropped
 * finished editions.
 */
export function briefFestivals(
  windowDays: number,
  venueNames?: string[],
  now: Date = new Date(),
): Festival[] {
  const ahead = Math.max(windowDays, FESTIVAL_LOOKAHEAD_DAYS);
  const horizon = warsawDay(new Date(now.getTime() + ahead * 24 * 3_600_000));
  const soon = listFestivals(now).filter(
    (f) => f.status === 'ongoing' || f.startDate <= horizon,
  );
  // GOI-33: a festival at cinemas the reader doesn't follow isn't their news.
  // With no venue list — the settings preview, which has no subscriber — keep
  // the unscoped behaviour rather than showing nothing.
  const scoped = venueNames ? festivalsAtVenues(soon, venueNames) : soon;
  return scoped.slice(0, MAX_BRIEF_FESTIVALS);
}

/** The Warsaw calendar day of an instant, as `listFestivals` files its dates. */
function warsawDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(at);
}

/** The widest cadence a config can produce — what an *empty* brief should
 *  still call itself. */
export function plannedFrequency(sub: {
  sendCadence: NewsletterSendCadence;
  categoryRules: NewsletterCategoryRule[];
}): NewsletterFrequency {
  if (sub.categoryRules.length === 0) return sub.sendCadence;
  const widest = Math.max(
    ...sub.categoryRules.map((r) => deriveWindowDays(sub.sendCadence, r)),
  );
  if (widest > 7) return 'monthly';
  return widest > 1 ? 'weekly' : 'daily';
}

/** A rule's coverage window in days — `deriveWindow` measured rather than
 *  dated, which is what the callers here actually want. */
export function deriveWindowDays(
  sendCadence: NewsletterSendCadence,
  rule: Pick<NewsletterCategoryRule, 'cadence' | 'lookaheadDays'>,
  issueDate: Date = new Date(),
): number {
  const { from, to } = deriveWindow({ sendCadence }, rule, issueDate);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** Subject line: the widest cadence in the email decides how it reads, since
 *  a brief carrying a monthly section is not "today in Warsaw". */
export function briefSubject(sections: BriefSection[]): string {
  const widest = sections.reduce((acc, s) => Math.max(acc, s.windowDays), 0);
  if (widest > 7) return 'AFISZ — your month in Warsaw';
  if (widest > 1) return 'AFISZ — your week in Warsaw';
  return 'AFISZ — today in Warsaw';
}

/**
 * How late a missed slot may still be delivered. The sweep runs every minute,
 * but a deploy or a restart can still straddle a send time — and matching on
 * "is it exactly the send time right now?" only ever gets one chance, so a
 * brief would silently vanish for a whole day (or week). Within this grace
 * window the next tick picks the slot back up; past it the brief is stale and
 * we wait for the next one rather than mailing yesterday's evening plans at
 * lunchtime.
 */
export const CATCH_UP_HOURS = 6;

/** The scheduling fields the due check reads. */
export interface BriefSchedule {
  sendCadence: NewsletterSendCadence;
  sendHour?: number;
  sendMinute?: number;
  sendWeekday?: number | null;
  sendDayOfMonth?: number | null;
  lastSentAt?: string | null;
}

/**
 * The slot this config was most recently due to go out in, at or before `now`
 * — null before its first one ever comes around.
 *
 * The envelope alone decides this now (GOI-100). It used to depend on the
 * category rules: a config with any rule was offered a slot every day and the
 * section builder dropped what wasn't due, which meant a "weekly" newsletter
 * with rules woke every morning and the reader's chosen weekday decided
 * nothing. The send cadence is the send cadence.
 */
export function dueSlot(sub: BriefSchedule, now: Date): Date | null {
  const weekday = sub.sendCadence === 'weekly' ? (sub.sendWeekday ?? 1) : undefined;
  const slot = lastWarsawTimeAtOrBefore(sub.sendHour ?? 8, sub.sendMinute ?? 0, weekday, now);
  if (!slot) return null;
  // A monthly newsletter goes out on one day of the month; every other day's
  // slot belongs to no issue.
  if (sub.sendCadence === 'monthly' && warsawDayOfMonth(slot) !== (sub.sendDayOfMonth ?? 1)) {
    return null;
  }
  return slot;
}

/**
 * Whether a brief is owed right now: its latest slot has arrived, is still
 * within the catch-up window, and nothing has been sent for it yet. Comparing
 * `lastSentAt` against the slot is what prevents a double send, so the sweep
 * no longer has to land on the one tick that matches the send time.
 */
export function isDue(sub: BriefSchedule, now: Date): boolean {
  const slot = dueSlot(sub, now);
  if (!slot) return false;
  if (now.getTime() - slot.getTime() > CATCH_UP_HOURS * 3_600_000) return false;
  if (!sub.lastSentAt) return true;
  return new Date(sub.lastSentAt).getTime() < slot.getTime();
}

/**
 * The venues a brief covers. An empty selection means "all *your* venues", as
 * the form says — not every venue in the database, which is what an empty
 * `venueIds` would mean to `selectBriefEvents` on its own.
 *
 * Returning an empty list means "brief nothing" and the caller skips the send
 * — never "brief everything".
 */
export async function resolveBriefVenues(
  userId: string,
  venueIds: string[],
  venues: UserVenueStore = defaultUserVenueStore,
): Promise<UserVenue[]> {
  const mine = await venues.listAll(userId);
  return venueIds.length > 0 ? mine.filter((v) => venueIds.includes(v.id)) : mine;
}

/**
 * Does this event belong to the named category?
 *
 * A "category" is whichever the reader picked: a built-in event category
 * ("cinema") or one of their own venue tags ("arthouse"). Accepting both means
 * the picker can offer one combined list and neither kind needs its own
 * plumbing.
 */
export function eventInCategory(event: Event, category: string, venueTags: Map<string, string[]>): boolean {
  const want = category.trim().toLowerCase();
  if (!want) return false;
  if (event.category.toLowerCase() === want) return true;
  return (venueTags.get(event.venueId) ?? []).some((t) => t.toLowerCase() === want);
}

/**
 * Which issues carry this category (GOI-100).
 *
 * The rule's cadence is relative to the envelope, so "is it due" is a question
 * about *which issue this is*, not about which day it is:
 *
 *  - `every_issue` — every issue there is, whatever the send cadence;
 *  - `weekly` — inside a daily newsletter, the issue on the rule's own
 *    weekday; inside a weekly one every issue already is weekly, so it is
 *    every issue (validation stops that combination being saved, but a row
 *    written before the rule existed must still behave sanely);
 *  - `monthly` — the first issue of each calendar month. For a daily
 *    newsletter that is the 1st; for a weekly one it is whichever send day
 *    falls first, which is the first seven days.
 */
export function isRuleDue(
  cadence: NewsletterRuleCadence,
  sendCadence: NewsletterSendCadence,
  now: Date,
  cadenceWeekday: number | null,
): boolean {
  if (cadence === 'every_issue') return true;
  if (cadence === 'weekly') {
    if (sendCadence !== 'daily') return true;
    return warsawWeekday(now) === (cadenceWeekday ?? 1);
  }
  // Monthly. The first issue of the month is the only one that carries it.
  if (sendCadence === 'daily') return warsawDayOfMonth(now) === 1;
  if (sendCadence === 'weekly') return warsawDayOfMonth(now) <= 7;
  return true;
}

/** Day of the month in Warsaw (1-31). */
function warsawDayOfMonth(at: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric' }).format(at));
}

/** One category's slice of a brief: the rule, plus the events it caught. */
export interface BriefSection {
  category: string;
  /** How far ahead this section reached, in days — its derived window. Kept
   *  on the section because the subject line and the PDF both need to know
   *  how wide the widest section was, and neither can re-derive it. */
  windowDays: number;
  detail: NewsletterDetail;
  events: Event[];
}

/**
 * Split the candidate events into the sections due in this issue.
 *
 * With no rules the brief is one unnamed section covering everything on the
 * config's own send cadence — the behaviour before per-category rules existed.
 * With rules, only the due ones appear, so a cinema section can turn up in
 * every issue while a monthly museums section joins it once a month.
 *
 * Each section brings its own window (`deriveWindow`) and its own time filter,
 * which is the point of GOI-100: a single global "only after 18:00" applied to
 * every section is what emptied museums, since exhibitions are daytime.
 *
 * An event matching two due rules is placed in the first, so nothing is listed
 * twice in one email.
 */
export function buildBriefSections(
  events: Event[],
  sub: {
    sendCadence: NewsletterSendCadence;
    categoryRules: NewsletterCategoryRule[];
    beforeHour?: number | null;
  },
  venues: UserVenue[],
  now: Date = new Date(),
): BriefSection[] {
  const venueIds = venues.map((v) => v.id);
  const venueTags = new Map(venues.map((v) => [v.id, v.tags]));

  if (sub.categoryRules.length === 0) {
    const picked = selectBriefEvents(
      events,
      { ...sub, windowDays: sendCadenceDays(sub.sendCadence), venueIds },
      now,
    );
    return picked.length
      ? [
          {
            category: '',
            windowDays: sendCadenceDays(sub.sendCadence),
            detail: 'short',
            events: picked,
          },
        ]
      : [];
  }

  const taken = new Set<string>();
  const sections: BriefSection[] = [];
  for (const rule of [...sub.categoryRules].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!isRuleDue(rule.cadence, sub.sendCadence, now, rule.cadenceWeekday)) continue;
    const windowDays = deriveWindowDays(sub.sendCadence, rule, now);
    const inWindow = selectBriefEvents(
      events,
      {
        ...sub,
        windowDays,
        venueIds,
        // Per-section, not per-newsletter. This is the fix GOI-100 exists for.
        afterHour: timeFilterHour(rule.timeFilter),
      },
      now,
    );
    const picked = inWindow.filter(
      (e) => !taken.has(e.id) && eventInCategory(e, rule.category, venueTags),
    );
    if (picked.length === 0) continue;
    for (const e of picked) taken.add(e.id);
    sections.push({
      category: rule.category,
      windowDays,
      detail: rule.detail,
      events: picked,
    });
  }
  return sections;
}

/** The wide first fetch. The cap the database itself enforces. */
export const BRIEF_FETCH_LIMIT = 500;
/** One rule's own fetch, once the wide one has come back full. */
const SECTION_FETCH_LIMIT = 100;
/** Every category a rule can name — `FEED_CATEGORIES` is the feed's list and
 *  leaves out `other`, which a venue can still be filed under. */
const RULE_CATEGORIES: Category[] = [...FEED_CATEGORIES, 'other'];

/**
 * The candidate events one issue is built from.
 *
 * Not a single `listUpcoming` capped at 500, which is what both callers used to
 * do. That query takes the *globally earliest* rows in the window, and a folder
 * with a cinema in it spends the cap long before a sparse category is reached:
 * a cinema publishes eight screenings a day, a theatre three a month and a
 * museum one show a season, so a brief whose window holds more than 500
 * screenings arrived with cinema in it and nothing else — the theatre and
 * museum sections were empty because their events were never fetched, not
 * because nothing was on. `listUpcomingWithCategoryFloor` documents the same
 * failure for the home feed.
 *
 * So: the wide fetch as before, and then, only if the cap actually bit, one
 * narrow fetch per due rule. A rule names either a category or one of the
 * reader's venue tags — the two branches `eventInCategory` matches on — so both
 * are narrowed here, by category and by the venues carrying the tag. The extra
 * queries are indexed, capped, and skipped entirely on the ordinary week where
 * the first fetch already returned the whole window.
 */
export async function fetchBriefEvents(
  sub: {
    sendCadence: NewsletterSendCadence;
    categoryRules: NewsletterCategoryRule[];
  },
  venues: UserVenue[],
  now: Date = new Date(),
  events: Pick<EventStore, 'listUpcoming'> = defaultEventStore,
): Promise<Event[]> {
  const venueIds = venues.map((v) => v.id);
  // An explicitly empty list means "no venues", not "all of them".
  if (venueIds.length === 0) return [];
  const until = new Date(now.getTime() + briefFetchWindowDays(sub, now) * 24 * 3_600_000);
  const base = await events.listUpcoming({ venueIds, now, until, limit: BRIEF_FETCH_LIMIT });
  if (base.length < BRIEF_FETCH_LIMIT) return base;

  const byId = new Map(base.map((e) => [e.id, e]));
  for (const rule of sub.categoryRules) {
    if (!isRuleDue(rule.cadence, sub.sendCadence, now, rule.cadenceWeekday)) continue;
    const ruleUntil = new Date(
      now.getTime() + deriveWindowDays(sub.sendCadence, rule, now) * 24 * 3_600_000,
    );
    for (const scope of ruleFetchScopes(rule.category, venues)) {
      const rows = await events.listUpcoming({
        ...scope, now, until: ruleUntil, limit: SECTION_FETCH_LIMIT,
      });
      for (const e of rows) if (!byId.has(e.id)) byId.set(e.id, e);
    }
  }
  return [...byId.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * How to narrow a fetch to one rule's events. Both branches of
 * `eventInCategory`, in the same order: the category the rule names, and the
 * venues tagged with it. A word can be both — "music" is a venue category and a
 * plausible tag — so this returns the scopes it matches rather than the first.
 */
function ruleFetchScopes(
  category: string,
  venues: UserVenue[],
): { venueIds: string[]; categories?: Category[] }[] {
  const want = category.trim().toLowerCase();
  if (!want) return [];
  const scopes: { venueIds: string[]; categories?: Category[] }[] = [];
  const named = RULE_CATEGORIES.find((c) => c === want);
  if (named) scopes.push({ venueIds: venues.map((v) => v.id), categories: [named] });
  const tagged = venues
    .filter((v) => v.tags.some((t) => t.toLowerCase() === want))
    .map((v) => v.id);
  if (tagged.length > 0) scopes.push({ venueIds: tagged });
  return scopes;
}

/**
 * How far back the changes block looks.
 *
 * Long enough that a cancellation noticed on Friday still reaches a weekly
 * issue on Monday, short enough that a config coming back after a month of
 * being switched off does not open with a history lesson. Dedup by state
 * stops anything inside it being reported twice, so the window only has to be
 * generous, not exact.
 */
export const CHANGE_LOOKBACK_DAYS = 14;

/**
 * The "want to go" block of one issue (GOI-101), already deduplicated.
 *
 * Reads the reader's saved events rather than the venue listing: this is a
 * queue over things they chose, so a saved event at a venue they have since
 * stopped following still belongs here. Cancelled events are deliberately
 * among them — a cancelled row is kept precisely so this can mention it.
 */
export async function buildWantToGoSection(
  sub: Pick<NewsletterSubscription, 'id' | 'userId' | 'wantToGo'>,
  // Only what it reads. The preview (GOI-110) substitutes `sentStates` to skip
  // dedup, and has no config row to hand over as the rest of a store.
  store: Pick<NewsletterStore, 'sentStates' | 'changesFor'>,
  wantToGo: Pick<WantToGoStore, 'list'>,
  now: Date,
): Promise<WantToGoSection> {
  if (!sub.wantToGo.enabled) return { reminders: [], changes: [] };

  const saved = await wantToGo.list(sub.userId);
  if (saved.length === 0) return { reminders: [], changes: [] };
  const byId = new Map(saved.map((e) => [e.id, e]));

  // Reminders. A cancelled event has nothing to remind anyone about — the
  // changes block below is where it belongs.
  const live = saved.filter((e) => !e.cancelledAt);
  const candidates = queueCandidates(live, { ...sub.wantToGo, changesEnabled: sub.wantToGo.changesEnabled }, now);
  const byState = new Map<string, Set<string>>();
  for (const state of new Set(candidates.map((c) => c.state))) {
    byState.set(state, await store.sentStates(sub.id, state, candidates.map((c) => c.event.id)));
  }
  const reminders = applyQueueDedup(candidates, byState);

  // Changes.
  let changes: QueuedChange[] = [];
  if (sub.wantToGo.changesEnabled) {
    const since = new Date(now.getTime() - CHANGE_LOOKBACK_DAYS * 86_400_000);
    const rows = await store.changesFor([...byId.keys()], since);
    const all: QueuedChange[] = rows.flatMap((r) => {
      const event = byId.get(r.eventId);
      return event
        ? [{ event, type: r.changeType, oldValue: r.oldValue, newValue: r.newValue }]
        : [];
    });
    const changeStates = new Map<string, Set<string>>();
    for (const type of new Set(all.map((c) => c.type))) {
      changeStates.set(
        changeState(type),
        await store.sentStates(
          sub.id,
          changeState(type),
          all.filter((c) => c.type === type).map((c) => c.event.id),
        ),
      );
    }
    changes = applyChangeDedup(all, changeStates);
  }

  return { reminders, changes };
}

/**
 * Record what an issue said, so the next one does not say it again.
 *
 * Called only after a successful send, and that ordering is the point: a
 * failed send that had already consumed the states would leave the reader
 * never told, with the system believing they had been.
 */
export async function recordWantToGoSent(
  configId: string,
  section: WantToGoSection,
  store: NewsletterStore,
  now: Date,
): Promise<void> {
  for (const [state, ids] of statesToRecord(section.reminders, section.changes)) {
    await store.recordSent(configId, state, ids, now);
  }
}

/**
 * The off-schedule sweep (GOI-101): mail the readers whose saved event was
 * cancelled or moved in the next 48 hours, now rather than at their next
 * scheduled issue.
 *
 * This email is *only* the changes block — no category sections, no reminder
 * list. It exists to say one thing, and padding it with the week's listings
 * would bury that thing under them.
 *
 * Three conditions, and each is there for a reason. `urgentSend` is the
 * reader's own switch. `isUrgent` narrows to cancellations and reschedules
 * inside 48 hours, because those are the two that leave someone standing
 * outside a dark theatre. And the 12-hour rate limit is what keeps a festival
 * dropping a day's programme from becoming six emails in an afternoon —
 * anything accumulating inside the window is not lost, it waits and goes out
 * together.
 */
export async function sendUrgentChanges(
  store: NewsletterStore = defaultNewsletterStore,
  now: Date = new Date(),
  opts: Pick<SweepOptions, 'wantToGo' | 'send' | 'dryRun' | 'only'> = {},
): Promise<{ sent: number; outcomes: { configId: string; email: string; changes: number }[] }> {
  const wantToGoStore = opts.wantToGo ?? defaultWantToGoStore;
  const all = await store.listEnabled();
  const subs = opts.only
    ? all.filter((s) => s.userId === opts.only || s.email.toLowerCase() === opts.only!.toLowerCase())
    : all;

  const outcomes: { configId: string; email: string; changes: number }[] = [];
  for (const sub of subs) {
    if (!sub.wantToGo.enabled || !sub.wantToGo.changesEnabled || !sub.wantToGo.urgentSend) continue;
    if (!urgentSendAllowed(await store.lastUrgentAt(sub.id), now)) continue;

    const section = await buildWantToGoSection(sub, store, wantToGoStore, now);
    const urgent = section.changes.filter((c) => isUrgent(c, now));
    if (urgent.length === 0) continue;
    if (opts.dryRun) {
      outcomes.push({ configId: sub.id, email: sub.email, changes: urgent.length });
      continue;
    }

    const brief = {
      // Only the changes. The reminders and the category sections keep until
      // the scheduled issue — they are not why this email exists.
      sections: [],
      wantToGo: { reminders: [], changes: urgent },
      fallbackFrequency: sub.sendCadence,
      recipientName: sub.recipientName,
      now,
    };
    try {
      await (opts.send ?? sendEmail)({
        to: sub.email,
        from: newsletterFromEmail(),
        subject: urgentSubject(urgent),
        html: renderBriefHtml(brief),
      });
    } catch (e) {
      console.error(`[newsletter] urgent send failed for ${sub.email}:`, e);
      continue;
    }
    // After the send, and both stamps together: the rate limit and the dedup
    // states must not diverge, or a failure would either re-send forever or
    // silently swallow the change.
    await store.markUrgentSent(sub.id, now);
    await recordWantToGoSent(sub.id, { reminders: [], changes: urgent }, store, now);
    outcomes.push({ configId: sub.id, email: sub.email, changes: urgent.length });
  }
  return { sent: outcomes.length, outcomes };
}

/** Names the event rather than the category — an urgent email is about one
 *  thing, and the subject line is where that thing should be. */
function urgentSubject(changes: QueuedChange[]): string {
  const first = changes[0]!;
  const verb = first.type === 'cancelled' ? 'cancelled' : 'moved';
  if (changes.length === 1) return `AFISZ — ${first.event.title} has been ${verb}`;
  return `AFISZ — ${changes.length} events you saved have changed`;
}

/**
 * Guard against double sends — a restart re-running the tick inside the same
 * hour. Since sections can now carry different cadences, there is no single
 * "period" to measure against; what actually bounds sends is the hourly tick
 * plus `isSendHour`, so anything within the last 50 minutes is a repeat.
 */
export function wasRecentlySent(sub: Pick<NewsletterSubscription, 'lastSentAt'>, now: Date): boolean {
  if (!sub.lastSentAt) return false;
  return now.getTime() - new Date(sub.lastSentAt).getTime() < 50 * 60_000;
}

/** Why a subscription did or didn't get a brief on a given sweep. Reported so
 *  "the newsletter isn't arriving" has an answer that isn't guesswork. */
export interface BriefOutcome {
  userId: string;
  email: string;
  frequency: NewsletterFrequency;
  status: 'sent' | 'skipped' | 'failed';
  /** Machine-readable reason for anything other than a plain send. */
  reason?: 'not-due' | 'recently-sent' | 'no-venues' | 'no-events' | 'send-failed' | 'no-drive';
  /** Human detail — the provider's message for a failure, counts otherwise. */
  detail?: string;
  /** The slot this subscription was last due in, ISO; null before its first. */
  dueAt?: string | null;
  eventCount?: number;
  /** Per-drive results for the filed PDF copy (GOI-91). Absent when the
   *  subscriber has no drive connected — which is most of them. */
  drives?: DriveDeliveryOutcome[];
}

export interface SweepOptions {
  /** The venue and event sources, injectable the way `store` already is.
   *  Without these the sweep reaches for the process-wide stores, which makes
   *  a test's behaviour depend on whether DATABASE_URL happens to be set. The
   *  saved-events queue (GOI-101) is the third such source, and fell into
   *  exactly that trap when it was added — the sweep only failed once the
   *  suite was run against a real Postgres. */
  wantToGo?: Pick<WantToGoStore, 'list'>;
  /** Work out every outcome without sending or recording anything. */
  dryRun?: boolean;
  /** Ignore the schedule (due slot + recent-send guard) and brief everyone
   *  who has events. For manual "send it now" checks after a config change. */
  force?: boolean;
  /** Restrict the sweep to one subscriber, by user id or email. */
  only?: string;
  /** The venue and event sources, injectable the way `store` already is.
   *  Without these the sweep reaches for the process-wide stores, which makes
   *  a test's behaviour depend on whether DATABASE_URL happens to be set. */
  venues?: UserVenueStore;
  events?: Pick<EventStore, 'listUpcoming'>;
  /** Drive delivery seams (GOI-91), injected in tests. */
  drive?: DeliverOptions;
  /**
   * The mail seam. Injected so a test can make a send *fail* — which is the
   * only way to check that a failed send does not consume the queue's dedup
   * states (GOI-101). Without it that guarantee is untestable, and it is the
   * one failure mode nothing can recover from: the reader is never told, and
   * the next issue skips what it believes it already said.
   */
  send?: typeof sendEmail;
  /** Skip filing the PDF copy entirely. The public API's `dryRun` already
   *  returns before this point; this is for a caller that wants the email
   *  and nothing else. */
  skipDrives?: boolean;
}

export interface SweepResult {
  sent: number;
  skipped: number;
  failed: number;
  outcomes: BriefOutcome[];
}

/**
 * One send sweep: every subscription whose slot is due (see `isDue`) gets the
 * brief its settings describe. Empty briefs are skipped — no "nothing on"
 * emails. Errors are per-recipient: one bad address doesn't stop the sweep,
 * it just lands in that recipient's outcome.
 */
export async function sendNewsletterBriefs(
  store: NewsletterStore = defaultNewsletterStore,
  now: Date = new Date(),
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const venueStore = opts.venues ?? defaultUserVenueStore;
  const eventStore = opts.events ?? defaultEventStore;
  const all = await store.listEnabled();
  const subs = opts.only
    ? all.filter((s) => s.userId === opts.only || s.email.toLowerCase() === opts.only!.toLowerCase())
    : all;
  const outcomes: BriefOutcome[] = [];

  for (const sub of subs) {
    const base = {
      userId: sub.userId,
      email: sub.email,
      frequency: sub.sendCadence,
      dueAt: dueSlot(sub, now)?.toISOString() ?? null,
    };
    if (!opts.force) {
      if (!isDue(sub, now)) {
        outcomes.push({ ...base, status: 'skipped', reason: 'not-due' });
        continue;
      }
      if (wasRecentlySent(sub, now)) {
        outcomes.push({ ...base, status: 'skipped', reason: 'recently-sent', detail: `last sent ${sub.lastSentAt}` });
        continue;
      }
    }
    try {
      const venues = await resolveBriefVenues(sub.userId, sub.venueIds, venueStore);
      // Nothing in scope — no venues followed, or none matched the selection.
      // An empty list must not fall through to "every venue in the database".
      if (venues.length === 0) {
        outcomes.push({ ...base, status: 'skipped', reason: 'no-venues' });
        continue;
      }
      // Narrowed in SQL, and per due rule once the cap bites — see
      // `fetchBriefEvents` for why one flat query left sparse sections empty.
      const events = await fetchBriefEvents(sub, venues, now, eventStore);
      const sections = buildBriefSections(events, sub, venues, now);

      // The saved-events queue counts as content (GOI-101). An issue whose
      // cinema, museums and theatre sections are all empty but which has three
      // saved events tomorrow *is* worth sending — in August it is likely to
      // be the only thing carrying the newsletter, and that is the intended
      // behaviour rather than a degenerate case.
      const wantToGo = await buildWantToGoSection(sub, store, opts.wantToGo ?? defaultWantToGoStore, now);

      if (sections.length === 0 && isEmptySection(wantToGo)) {
        outcomes.push({
          ...base, status: 'skipped', reason: 'no-events', eventCount: 0,
          detail: `${events.length} upcoming event(s) at ${venues.length} venue(s) in the window, no section was due with anything in it and nothing saved is coming up`,
        });
        continue;
      }
      const eventCount =
        sections.reduce((n, sec) => n + sec.events.length, 0)
        + wantToGo.reminders.length
        + wantToGo.changes.length;
      if (opts.dryRun) {
        outcomes.push({ ...base, status: 'sent', eventCount, detail: 'dry run — not actually sent' });
        continue;
      }
      // Both renderings describe the same brief, so they are built from one
      // set of arguments rather than assembled twice.
      const brief = {
        sections,
        wantToGo,
        fallbackFrequency: plannedFrequency(sub),
        recipientName: sub.recipientName,
        // Scoped to this subscriber's venues (GOI-33).
        festivals: briefFestivals(
          briefWindowDays(plannedFrequency(sub)),
          venues.map((v) => v.name),
          now,
        ),
        now,
      };
      if (deliversByEmail(sub.delivery)) {
        await (opts.send ?? sendEmail)({
          to: sub.email,
          from: newsletterFromEmail(),
          subject: briefSubject(sections),
          html: renderBriefHtml(brief),
        });
      }

      // File a PDF on any drive this user connected (GOI-91).
      //
      // For `both` this is the copy it has always been, and it runs after the
      // email for the reason it always did: `deliverBriefToDrives` never
      // throws, but ordering it here means that even if that changed, a drive
      // outage could not cost the subscriber the brief they were sent.
      //
      // For `drive` it is the delivery itself, so the two lines below are not
      // interchangeable with the ones above — nothing is marked sent until the
      // upload is known to have worked.
      const drives = deliversToDrive(sub.delivery) && !opts.skipDrives
        ? await deliverBriefToDrives(sub.userId, brief, plannedFrequency(sub), {
            ...opts.drive,
            now,
          })
        : [];

      if (sub.delivery === 'drive') {
        // No drive connected. Not a failure — the reader asked for something
        // that needs a step they have not taken — but emphatically not a send
        // either, so nothing is stamped and the next sweep will try again.
        if (drives.length === 0) {
          outcomes.push({
            ...base, status: 'skipped', reason: 'no-drive', eventCount,
            detail: 'set to file to a drive, but no drive is connected',
          });
          continue;
        }
        // Every drive refused it. With no email to fall back on, the reader
        // got nothing.
        if (!drives.some((d) => d.status === 'uploaded')) {
          outcomes.push({
            ...base, status: 'failed', reason: 'send-failed', eventCount, drives,
            detail: drives.map((d) => d.reason).filter(Boolean).join('; ')
              || 'no drive accepted the brief',
          });
          continue;
        }
      }

      // By config id, not user id: a reader may hold one newsletter per folder
      // since GOI-100, and stamping the user would mark all of them sent.
      await store.markSent(sub.id, now);
      // After the send, never before (GOI-101): a failed send that had already
      // consumed the states would leave the reader never told, with the system
      // believing they had been.
      await recordWantToGoSent(sub.id, wantToGo, store, now);

      outcomes.push({
        ...base,
        status: 'sent',
        eventCount,
        ...(drives.length ? { drives } : {}),
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`[newsletter] send to ${sub.email} failed:`, detail);
      outcomes.push({ ...base, status: 'failed', reason: 'send-failed', detail });
    }
  }

  return {
    sent: outcomes.filter((o) => o.status === 'sent').length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
    outcomes,
  };
}

/** Config the sender needs to actually deliver anything, as booleans a human
 *  can read off `/admin/newsletter` instead of inferring from silence. */
export function newsletterConfigStatus() {
  const problems: string[] = [];
  if (!env.NEWSLETTER_CRON_ENABLED) problems.push('NEWSLETTER_CRON_ENABLED is not set — the send sweep never starts');
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is not set — subscriptions and events are in-memory only');
  if (!env.RESEND_API_KEY) problems.push('RESEND_API_KEY is not set — sends throw before reaching Resend');
  return {
    schedulerEnabled: env.NEWSLETTER_CRON_ENABLED && !!env.DATABASE_URL,
    newsletterCronEnabled: !!env.NEWSLETTER_CRON_ENABLED,
    databaseConfigured: !!env.DATABASE_URL,
    resendConfigured: !!env.RESEND_API_KEY,
    fromEmail: newsletterFromEmail(),
    transactionalFromEmail: env.RESEND_FROM_EMAIL,
    catchUpHours: CATCH_UP_HOURS,
    problems,
  };
}

/** Delay before the sweep that runs on boot. Long enough for the DB pool to
 *  be up, short enough that a deploy landing on a send time still delivers. */
const STARTUP_SWEEP_DELAY_MS = 60_000;

/**
 * How often the sweep looks for due briefs. Subscriptions pick their own send
 * time down to the minute, so the tick has to be at least that fine — anything
 * coarser rounds every send to the tick boundary. A sweep with nothing due is
 * one indexed query against a table with a row per subscriber, which is cheap
 * enough to run every minute.
 */
const TICK_MS = 60_000;

/**
 * In-process newsletter scheduler, same shape as the scrape scheduler. Each
 * subscription picks its own send time (and weekday), so the loop ticks on a
 * fixed interval and the sweep decides who is due — one loop serves every
 * cadence and every chosen time.
 *
 * A sweep also runs shortly after boot. Deploys are the common way to miss a
 * slot (Railway restarts the process), and the catch-up window in `isDue`
 * makes that sweep safe to repeat — already-sent subscriptions are no longer
 * due.
 */
export function startNewsletterScheduler(): { stop: () => void } {
  let timer: NodeJS.Timeout | null = null;
  let startupTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  const sweep = async (label: string) => {
    try {
      const res = await sendNewsletterBriefs();
      console.log(`[newsletter] ${label} done: ${res.sent} sent, ${res.skipped} skipped, ${res.failed} failed`);
      for (const o of res.outcomes.filter((x) => x.status === 'failed')) {
        console.error(`[newsletter] ${o.email}: ${o.detail}`);
      }
    } catch (e) {
      console.error(`[newsletter] ${label} failed:`, e);
    }

    // Off-schedule change emails ride the same tick (GOI-101). Its own rate
    // limit — one per config per 12 hours — is what makes running it this
    // often safe; the tick only decides how soon a cancellation can go out,
    // not how often anyone is mailed.
    try {
      const urgent = await sendUrgentChanges();
      if (urgent.sent > 0) console.log(`[newsletter] ${urgent.sent} urgent change email(s) sent`);
    } catch (e) {
      console.error('[newsletter] urgent sweep failed:', e);
    }

    // Retention (GOI-100): send state older than 120 days refers to events
    // months past and is telling nobody anything.
    try {
      const before = new Date(Date.now() - SENT_EVENT_RETENTION_DAYS * 86_400_000);
      const dropped = await defaultNewsletterStore.pruneSentEvents(before);
      if (dropped > 0) console.log(`[newsletter] pruned ${dropped} expired send-state row(s)`);
    } catch (e) {
      console.error('[newsletter] send-state prune failed:', e);
    }
  };

  for (const problem of newsletterConfigStatus().problems) {
    console.warn(`[newsletter] ${problem}`);
  }

  startupTimer = setTimeout(() => { void sweep('startup sweep'); }, STARTUP_SWEEP_DELAY_MS);
  startupTimer.unref?.();

  // Re-armed after each sweep rather than setInterval'd, so a slow sweep can't
  // overlap itself.
  const arm = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      await sweep('sweep');
      arm();
    }, TICK_MS);
    timer.unref?.();
  };

  console.log(`[newsletter] send sweep every ${TICK_MS / 1000}s; each subscription goes out at its own time (${TZ})`);
  arm();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (startupTimer) clearTimeout(startupTimer);
    },
  };
}

import type {
  Event, Festival, NewsletterCategoryRule, NewsletterDetail, NewsletterFrequency,
} from '@goin/shared';
import { listFestivals } from '../data/festivals.js';
import { renderBriefHtml } from './newsletter-render.js';
import { defaultEventStore } from './event-store.js';
import { defaultUserVenueStore, type UserVenue, type UserVenueStore } from './user-venue-store.js';
import { sendEmail } from './email.js';
import { defaultNewsletterStore, type NewsletterStore, type NewsletterSubscription } from './newsletter-store.js';
import { msUntilNextWarsawHour, warsawHourOf, warsawWeekday } from './scheduler.js';

const TZ = 'Europe/Warsaw';

// Newsletter briefs (GOI-8): a daily/weekly email of upcoming events at the
// venues the user picked, optionally narrowed to a time-of-day window
// ("Kino Muranów and Kinoteka every day, everything after 6 pm").

/** How far ahead a section looks — one day, one week, or one month. */
export function briefWindowDays(frequency: NewsletterFrequency): number {
  if (frequency === 'daily') return 1;
  return frequency === 'weekly' ? 7 : 30;
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
  frequency: NewsletterFrequency;
  /** The venues the brief covers. Already narrowed by the chosen tags — see
   *  `resolveBriefVenueIds`, which is what turns tags into venue ids. */
  venueIds: string[];
  afterHour?: number | null;
  beforeHour?: number | null;
}

/**
 * Which events belong in a brief: within the cadence window, at one of the
 * chosen venues (empty selection = all), inside the after/before-hour window.
 */
export function selectBriefEvents(
  events: Event[],
  sub: BriefScope,
  now: Date = new Date(),
): Event[] {
  const horizon = new Date(now.getTime() + briefWindowDays(sub.frequency) * 24 * 3_600_000);
  return events.filter((e) => {
    const starts = new Date(e.startsAt);
    if (starts < now || starts > horizon) return false;
    if (sub.venueIds.length > 0 && !sub.venueIds.includes(e.venueId)) return false;
    const hour = warsawHour(e.startsAt);
    if (sub.afterHour != null && hour < sub.afterHour) return false;
    if (sub.beforeHour != null && hour >= sub.beforeHour) return false;
    return true;
  });
}

/** The ongoing festival the brief's "Also on" line calls out, if any. */
export function currentFestival(): Festival | null {
  return listFestivals().find((f) => f.status === 'ongoing') ?? null;
}

/** The widest cadence a subscription can produce — what an *empty* brief
 *  should still call itself. */
export function plannedFrequency(sub: {
  frequency: NewsletterFrequency;
  categoryRules: NewsletterCategoryRule[];
}): NewsletterFrequency {
  if (sub.categoryRules.length === 0) return sub.frequency;
  return sub.categoryRules.reduce<NewsletterFrequency>(
    (acc, r) => (briefWindowDays(r.frequency) > briefWindowDays(acc) ? r.frequency : acc),
    'daily',
  );
}

/** Subject line: the widest cadence in the email decides how it reads, since
 *  a brief carrying a monthly section is not "today in Warsaw". */
export function briefSubject(sections: BriefSection[]): string {
  const widest = sections.reduce(
    (acc, s) => Math.max(acc, briefWindowDays(s.frequency)),
    0,
  );
  if (widest > 7) return 'Goin — your month in Warsaw';
  if (widest > 1) return 'Goin — your week in Warsaw';
  return 'Goin — today in Warsaw';
}

/** True when `at` falls on the weekday this subscription's weekly brief goes
 *  out (Warsaw). Defaults to Monday for rows saved before send days existed. */
export function isWeeklySendDay(at: Date, sendWeekday: number = 1): boolean {
  return warsawWeekday(at) === sendWeekday;
}

/** True when `at` is the Warsaw hour this subscription asked to be sent at. */
export function isSendHour(at: Date, sendHour: number = 8): boolean {
  return warsawHourOf(at) === sendHour;
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
 * Is a rule due right now? Its cadence decides which day it lands on; the
 * subscription's `sendHour` decides the hour, so every due section arrives in
 * the same email rather than trickling out through the day.
 *
 *  - daily — every day;
 *  - weekly — on the subscription's chosen weekday;
 *  - monthly — on the 1st.
 */
export function isRuleDue(
  frequency: NewsletterFrequency,
  now: Date,
  sendWeekday: number,
): boolean {
  if (frequency === 'daily') return true;
  if (frequency === 'weekly') return warsawWeekday(now) === sendWeekday;
  return warsawDayOfMonth(now) === 1;
}

/** Day of the month in Warsaw (1-31). */
function warsawDayOfMonth(at: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric' }).format(at));
}

/** One category's slice of a brief: the rule, plus the events it caught. */
export interface BriefSection {
  category: string;
  frequency: NewsletterFrequency;
  detail: NewsletterDetail;
  events: Event[];
}

/**
 * Split the candidate events into the sections due right now.
 *
 * With no rules the brief is one unnamed section covering everything on the
 * subscription's own cadence — the behaviour before per-category rules
 * existed. With rules, only the due ones appear, so a daily cinema section can
 * turn up every morning while a monthly museums section joins it on the 1st.
 *
 * An event matching two due rules is placed in the first, so nothing is
 * listed twice in one email.
 */
export function buildBriefSections(
  events: Event[],
  sub: {
    frequency: NewsletterFrequency;
    sendWeekday: number;
    categoryRules: NewsletterCategoryRule[];
    afterHour?: number | null;
    beforeHour?: number | null;
  },
  venues: UserVenue[],
  now: Date = new Date(),
): BriefSection[] {
  const venueIds = venues.map((v) => v.id);
  const venueTags = new Map(venues.map((v) => [v.id, v.tags]));

  if (sub.categoryRules.length === 0) {
    const picked = selectBriefEvents(events, { ...sub, venueIds }, now);
    return picked.length
      ? [{ category: '', frequency: sub.frequency, detail: 'short', events: picked }]
      : [];
  }

  const taken = new Set<string>();
  const sections: BriefSection[] = [];
  for (const rule of sub.categoryRules) {
    if (!isRuleDue(rule.frequency, now, sub.sendWeekday)) continue;
    const inWindow = selectBriefEvents(events, { ...sub, frequency: rule.frequency, venueIds }, now);
    const picked = inWindow.filter(
      (e) => !taken.has(e.id) && eventInCategory(e, rule.category, venueTags),
    );
    if (picked.length === 0) continue;
    for (const e of picked) taken.add(e.id);
    sections.push({
      category: rule.category,
      frequency: rule.frequency,
      detail: rule.detail,
      events: picked,
    });
  }
  return sections;
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

/**
 * One send sweep: every subscription whose chosen send hour is the current
 * Warsaw hour — and, for weekly ones, whose chosen weekday is today (GOI-28).
 * Empty briefs are skipped — no "nothing on" emails. Errors are per-recipient:
 * one bad address doesn't stop the sweep.
 */
export async function sendNewsletterBriefs(
  store: NewsletterStore = defaultNewsletterStore,
  now: Date = new Date(),
): Promise<{ sent: number; skipped: number }> {
  const subs = await store.listEnabled();
  let sent = 0;
  let skipped = 0;
  for (const sub of subs) {
    if (!isSendHour(now, sub.sendHour)) { skipped++; continue; }
    // With no per-category rules the whole brief runs on one cadence, so the
    // old weekday gate still applies. With rules, each section brings its own.
    if (sub.categoryRules.length === 0 && !isRuleDue(sub.frequency, now, sub.sendWeekday)) {
      skipped++; continue;
    }
    if (wasRecentlySent(sub, now)) { skipped++; continue; }
    try {
      const all = await defaultEventStore.listUpcoming({ limit: 500 });
      const venues = await resolveBriefVenues(sub.userId, sub.venueIds);
      // Nothing in scope — no venues followed, or none matched the selection.
      // An empty list must not fall through to "every venue in the database".
      if (venues.length === 0) { skipped++; continue; }
      const sections = buildBriefSections(all, sub, venues, now);
      if (sections.length === 0) { skipped++; continue; }
      await sendEmail({
        to: sub.email,
        subject: briefSubject(sections),
        html: renderBriefHtml({
          sections,
          fallbackFrequency: plannedFrequency(sub),
          recipientName: sub.recipientName,
          festival: currentFestival(),
          now,
        }),
      });
      await store.markSent(sub.userId, now);
      sent++;
    } catch (e) {
      console.error(`[newsletter] send to ${sub.email} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { sent, skipped };
}

/**
 * In-process newsletter scheduler, same shape as the scrape scheduler. Since
 * GOI-28 each subscription picks its own send hour (and weekday), so the tick
 * runs hourly and the sweep decides who is due — one loop serves every
 * cadence and every chosen time.
 */
export function startNewsletterScheduler(): { stop: () => void } {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const arm = () => {
    if (stopped) return;
    // Next top of the hour, Warsaw. msUntilNextWarsawHour takes an hour of the
    // day, so ask for the one after the current wall-clock hour.
    const delay = msUntilNextWarsawHour((warsawHourOf(new Date()) + 1) % 24);
    console.log(`[newsletter] next send sweep in ${(delay / 60_000).toFixed(0)}m (hourly, ${TZ})`);
    timer = setTimeout(async () => {
      try {
        const res = await sendNewsletterBriefs();
        console.log(`[newsletter] sweep done: ${res.sent} sent, ${res.skipped} skipped`);
      } catch (e) {
        console.error('[newsletter] sweep failed:', e);
      } finally {
        arm();
      }
    }, delay);
    timer.unref?.();
  };

  arm();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

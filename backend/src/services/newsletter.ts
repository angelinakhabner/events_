import type {
  Event, Festival, NewsletterCategoryRule, NewsletterDetail, NewsletterFrequency,
} from '@goin/shared';
import { festivalsAtVenues } from '@goin/shared';
import { listFestivals } from '../data/festivals.js';
import { renderBriefHtml } from './newsletter-render.js';
import { defaultEventStore, type EventStore } from './event-store.js';
import { defaultUserVenueStore, type UserVenue, type UserVenueStore } from './user-venue-store.js';
import { sendEmail } from './email.js';
import { defaultNewsletterStore, type NewsletterStore, type NewsletterSubscription } from './newsletter-store.js';
import { lastWarsawTimeAtOrBefore, warsawWeekday } from './scheduler.js';
import { env } from '../config.js';

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
export function currentFestival(venueNames?: string[]): Festival | null {
  const ongoing = listFestivals().filter((f) => f.status === 'ongoing');
  // GOI-33: a festival at cinemas the reader doesn't follow isn't their news.
  // With no venue list — the settings preview, which has no subscriber — keep
  // the unscoped behaviour rather than showing nothing.
  if (!venueNames) return ongoing[0] ?? null;
  return festivalsAtVenues(ongoing, venueNames)[0] ?? null;
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
  frequency: NewsletterFrequency;
  categoryRules?: NewsletterCategoryRule[];
  sendHour?: number;
  sendMinute?: number;
  sendWeekday?: number;
  lastSentAt?: string | null;
}

/**
 * The slot this subscription was most recently due to go out in, at or before
 * `now` — null before its first one ever comes around.
 *
 * Per-category rules bring their own cadence, so the *slot* only decides the
 * time of day: a subscription with rules is offered every day and
 * `buildBriefSections` drops the sections that aren't due yet.
 */
export function dueSlot(sub: BriefSchedule, now: Date): Date | null {
  const perCategory = (sub.categoryRules?.length ?? 0) > 0;
  const weekday = !perCategory && sub.frequency === 'weekly' ? sub.sendWeekday ?? 1 : undefined;
  return lastWarsawTimeAtOrBefore(sub.sendHour ?? 8, sub.sendMinute ?? 0, weekday, now);
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

/** Why a subscription did or didn't get a brief on a given sweep. Reported so
 *  "the newsletter isn't arriving" has an answer that isn't guesswork. */
export interface BriefOutcome {
  userId: string;
  email: string;
  frequency: NewsletterFrequency;
  status: 'sent' | 'skipped' | 'failed';
  /** Machine-readable reason for anything other than a plain send. */
  reason?: 'not-due' | 'recently-sent' | 'no-venues' | 'no-events' | 'send-failed';
  /** Human detail — the provider's message for a failure, counts otherwise. */
  detail?: string;
  /** The slot this subscription was last due in, ISO; null before its first. */
  dueAt?: string | null;
  eventCount?: number;
}

export interface SweepOptions {
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
      frequency: sub.frequency,
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
      // Narrow in SQL, not after the fact: `limit` cuts the globally earliest
      // rows, so fetching "the next 500 events" and filtering by venue here
      // silently truncated a weekly brief once the database held more than 500
      // upcoming events across all venues — the later days just vanished. The
      // window is the widest any section can ask for.
      const events = await eventStore.listUpcoming({
        venueIds: venues.map((v) => v.id),
        now,
        until: new Date(now.getTime() + briefWindowDays(plannedFrequency(sub)) * 24 * 3_600_000),
        limit: 500,
      });
      const sections = buildBriefSections(events, sub, venues, now);
      if (sections.length === 0) {
        outcomes.push({
          ...base, status: 'skipped', reason: 'no-events', eventCount: 0,
          detail: `${events.length} upcoming event(s) at ${venues.length} venue(s) in the window, no section was due with anything in it`,
        });
        continue;
      }
      const eventCount = sections.reduce((n, sec) => n + sec.events.length, 0);
      if (opts.dryRun) {
        outcomes.push({ ...base, status: 'sent', eventCount, detail: 'dry run — not actually sent' });
        continue;
      }
      await sendEmail({
        to: sub.email,
        subject: briefSubject(sections),
        html: renderBriefHtml({
          sections,
          fallbackFrequency: plannedFrequency(sub),
          recipientName: sub.recipientName,
          // Scoped to this subscriber's venues (GOI-33).
          festival: currentFestival(venues.map((v) => v.name)),
          now,
        }),
      });
      await store.markSent(sub.userId, now);
      outcomes.push({ ...base, status: 'sent', eventCount });
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
    fromEmail: env.RESEND_FROM_EMAIL,
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

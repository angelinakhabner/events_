import type { Event, NewsletterEventDayMode, NewsletterFrequency } from '@goin/shared';
import { defaultEventStore, type EventStore } from './event-store.js';
import { defaultUserVenueStore, type UserVenueStore } from './user-venue-store.js';
import { sendEmail } from './email.js';
import { defaultNewsletterStore, type NewsletterStore, type NewsletterSubscription } from './newsletter-store.js';
import { lastWarsawTimeAtOrBefore, msUntilNextWarsawHour, warsawHourOf, warsawWeekday } from './scheduler.js';
import { env } from '../config.js';

const TZ = 'Europe/Warsaw';

// Newsletter briefs (GOI-8): a daily/weekly email of upcoming events at the
// venues the user picked, optionally narrowed to a time-of-day window
// ("Kino Muranów and Kinoteka every day, everything after 6 pm").

/** How far ahead a brief looks: today's events for daily, the week for weekly. */
export function briefWindowDays(frequency: NewsletterFrequency): number {
  return frequency === 'daily' ? 1 : 7;
}

/** Warsaw wall-clock hour of an ISO instant. */
function warsawHour(iso: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })
    .format(new Date(iso));
  return Number(h) % 24;
}

/** Warsaw calendar day (YYYY-MM-DD) of an ISO instant. */
function warsawDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
}

/** The subset of a subscription that decides what lands in a brief. Written
 *  out (rather than Pick'd) so callers holding freshly-parsed input, where the
 *  optional narrowing fields may be absent, can pass it straight through. */
export interface BriefScope {
  frequency: NewsletterFrequency;
  venueIds: string[];
  afterHour?: number | null;
  beforeHour?: number | null;
  eventDayMode?: NewsletterEventDayMode;
  eventDay?: number | null;
}

/**
 * Titles that run on *every* calendar day of the window — the "events
 * happening every day" scope. A one-day window (daily briefs) makes every
 * title trivially qualify, which is the sensible reading there.
 */
function titlesRunningEveryDay(events: Event[], windowDays: number): Set<string> {
  const daysByTitle = new Map<string, Set<string>>();
  for (const e of events) {
    const key = e.title.toLowerCase();
    const days = daysByTitle.get(key) ?? new Set<string>();
    days.add(warsawDay(e.startsAt));
    daysByTitle.set(key, days);
  }
  const out = new Set<string>();
  for (const [title, days] of daysByTitle) {
    if (days.size >= windowDays) out.add(title);
  }
  return out;
}

/**
 * Which events belong in a brief: within the cadence window, at one of the
 * chosen venues (empty selection = all), inside the after/before-hour window,
 * and matching the chosen day scope (everything / only titles running every
 * day / only one weekday).
 */
export function selectBriefEvents(
  events: Event[],
  sub: BriefScope,
  now: Date = new Date(),
): Event[] {
  const windowDays = briefWindowDays(sub.frequency);
  const horizon = new Date(now.getTime() + windowDays * 24 * 3_600_000);
  const inWindow = events.filter((e) => {
    const starts = new Date(e.startsAt);
    if (starts < now || starts > horizon) return false;
    if (sub.venueIds.length > 0 && !sub.venueIds.includes(e.venueId)) return false;
    const hour = warsawHour(e.startsAt);
    if (sub.afterHour != null && hour < sub.afterHour) return false;
    if (sub.beforeHour != null && hour >= sub.beforeHour) return false;
    return true;
  });

  const mode = sub.eventDayMode ?? 'all';
  if (mode === 'specific') {
    if (sub.eventDay == null) return inWindow;
    return inWindow.filter((e) => warsawWeekday(new Date(e.startsAt)) === sub.eventDay);
  }
  if (mode === 'daily') {
    const everyDay = titlesRunningEveryDay(inWindow, windowDays);
    return inWindow.filter((e) => everyDay.has(e.title.toLowerCase()));
  }
  return inWindow;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function fmtDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(iso));
}

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(iso));
}

/** Render the brief: events grouped by day, each row time · title · venue. */
export function renderBriefHtml(events: Event[], frequency: NewsletterFrequency): string {
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const byDay = new Map<string, Event[]>();
  for (const e of sorted) {
    const day = fmtDay(e.startsAt);
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  }
  const intro = frequency === 'daily' ? 'Today at your venues' : 'This week at your venues';
  const sections = [...byDay.entries()]
    .map(
      ([day, dayEvents]) =>
        `<h3 style="margin:16px 0 4px;font-size:14px">${escapeHtml(day)}</h3>` +
        `<ul style="margin:0;padding-left:18px">` +
        dayEvents
          .map(
            (e) =>
              `<li style="margin:2px 0;font-size:14px">${fmtTime(e.startsAt)} — ` +
              `<a href="${escapeHtml(e.sourceUrl)}">${escapeHtml(e.title)}</a>` +
              (e.venue ? ` <span style="color:#777">· ${escapeHtml(e.venue.name)}</span>` : '') +
              `</li>`,
          )
          .join('') +
        `</ul>`,
    )
    .join('');
  return (
    `<p style="font-size:15px">${intro}:</p>` +
    (sections || '<p style="color:#777;font-size:14px">Nothing on in this window.</p>') +
    `<p style="margin-top:20px;font-size:12px;color:#777">You get this brief because you enabled it on ` +
    `<a href="${escapeHtml(env.APP_URL)}/my">your Goin page</a> — manage or disable it there.</p>`
  );
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
 * How late a missed slot may still be delivered. The sweep runs hourly, so a
 * deploy, a restart or a timer that fires a hair before the top of the hour
 * would otherwise drop a brief for a whole day (or week) — matching on "is it
 * exactly the send hour right now?" only ever gets one chance. Within this
 * grace window the next tick picks the slot back up; past it the brief is
 * stale and we wait for the next one rather than mailing yesterday's evening
 * plans at lunchtime.
 */
export const CATCH_UP_HOURS = 6;

/**
 * The slot this subscription was most recently due to go out in, at or before
 * `now` — null before its first one ever comes around.
 */
export function dueSlot(sub: BriefSchedule, now: Date): Date | null {
  const weekday = sub.frequency === 'weekly' ? sub.sendWeekday ?? 1 : undefined;
  return lastWarsawTimeAtOrBefore(sub.sendHour ?? 8, weekday, now);
}

/** The scheduling fields the due check reads. */
export interface BriefSchedule {
  frequency: NewsletterFrequency;
  sendHour?: number;
  sendWeekday?: number;
  lastSentAt?: string | null;
}

/**
 * Whether a brief is owed right now: its latest slot has arrived, is still
 * within the catch-up window, and nothing has been sent for it yet. This
 * replaces the old exact-hour comparison — `lastSentAt` versus the slot is
 * what actually prevents a double send, so the sweep no longer has to land on
 * the one tick that matches the hour.
 */
export function isDue(sub: BriefSchedule, now: Date): boolean {
  const slot = dueSlot(sub, now);
  if (!slot) return false;
  if (now.getTime() - slot.getTime() > CATCH_UP_HOURS * 3_600_000) return false;
  if (!sub.lastSentAt) return true;
  return new Date(sub.lastSentAt).getTime() < slot.getTime();
}

/**
 * Which venues a brief covers. An empty selection means "all *your* venues",
 * as the form says — not every venue in the database, which is what an empty
 * `venueIds` would mean to `selectBriefEvents` on its own.
 */
export async function resolveBriefVenueIds(
  userId: string,
  venueIds: string[],
  venues: UserVenueStore = defaultUserVenueStore,
): Promise<string[]> {
  if (venueIds.length > 0) return venueIds;
  return (await venues.listAll(userId)).map((v) => v.id);
}

/** Guard against double sends (e.g. a restart re-running the tick): skip
 *  subscriptions already sent within ~80% of their cadence period. */
export function wasRecentlySent(sub: NewsletterSubscription, now: Date): boolean {
  if (!sub.lastSentAt) return false;
  const periodMs = briefWindowDays(sub.frequency) * 24 * 3_600_000;
  return now.getTime() - new Date(sub.lastSentAt).getTime() < periodMs * 0.8;
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
      const venueIds = await resolveBriefVenueIds(sub.userId, sub.venueIds, venueStore);
      // No venues followed at all — nothing to brief on, and an empty list
      // must not fall through to "every venue in the database".
      if (venueIds.length === 0) {
        outcomes.push({ ...base, status: 'skipped', reason: 'no-venues' });
        continue;
      }
      // Narrow in SQL, not after the fact: `limit` cuts the globally earliest
      // rows, so fetching "the next 500 events" and filtering by venue here
      // silently truncated a weekly brief once the database held more than 500
      // upcoming events across all venues — the later days just vanished.
      const events = await eventStore.listUpcoming({
        venueIds,
        now,
        until: new Date(now.getTime() + briefWindowDays(sub.frequency) * 24 * 3_600_000),
        limit: 500,
      });
      const selected = selectBriefEvents(events, { ...sub, venueIds }, now);
      if (selected.length === 0) {
        outcomes.push({
          ...base, status: 'skipped', reason: 'no-events', eventCount: 0,
          detail: `${events.length} upcoming event(s) at ${venueIds.length} venue(s) in the window, none matched this brief's hours/day scope`,
        });
        continue;
      }
      if (opts.dryRun) {
        outcomes.push({ ...base, status: 'sent', eventCount: selected.length, detail: 'dry run — not actually sent' });
        continue;
      }
      await sendEmail({
        to: sub.email,
        subject: sub.frequency === 'daily' ? 'Goin — today at your venues' : 'Goin — your week ahead',
        html: renderBriefHtml(selected, sub.frequency),
      });
      await store.markSent(sub.userId, now);
      outcomes.push({ ...base, status: 'sent', eventCount: selected.length });
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
  if (!env.NEWSLETTER_CRON_ENABLED) problems.push('NEWSLETTER_CRON_ENABLED is not set — the hourly sweep never starts');
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
 *  be up, short enough that a deploy landing on a send hour still delivers. */
const STARTUP_SWEEP_DELAY_MS = 60_000;

/**
 * In-process newsletter scheduler, same shape as the scrape scheduler. Since
 * GOI-28 each subscription picks its own send hour (and weekday), so the tick
 * runs hourly and the sweep decides who is due — one loop serves every
 * cadence and every chosen time.
 *
 * A sweep also runs shortly after boot. Deploys are the common way to miss a
 * slot (Railway restarts the process, and the first hourly tick can be up to
 * an hour out), and the catch-up window in `isDue` makes that sweep safe to
 * repeat — already-sent subscriptions are no longer due.
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

  const arm = () => {
    if (stopped) return;
    // Next top of the hour, Warsaw. msUntilNextWarsawHour takes an hour of the
    // day, so ask for the one after the current wall-clock hour.
    const delay = msUntilNextWarsawHour((warsawHourOf(new Date()) + 1) % 24);
    console.log(`[newsletter] next send sweep in ${(delay / 60_000).toFixed(0)}m (hourly, ${TZ})`);
    timer = setTimeout(async () => {
      await sweep('sweep');
      arm();
    }, delay);
    timer.unref?.();
  };

  arm();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (startupTimer) clearTimeout(startupTimer);
    },
  };
}

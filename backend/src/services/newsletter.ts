import type { Event, NewsletterFrequency } from '@goin/shared';
import { defaultEventStore } from './event-store.js';
import { defaultUserVenueStore, type UserVenueStore } from './user-venue-store.js';
import { sendEmail } from './email.js';
import { defaultNewsletterStore, type NewsletterStore, type NewsletterSubscription } from './newsletter-store.js';
import { msUntilNextWarsawHour, warsawHourOf, warsawWeekday } from './scheduler.js';
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
 * Which venues a brief covers, resolving both of the form's scoping controls
 * against the user's own venues:
 *
 *  - an empty venue selection means "all *your* venues", as the form says —
 *    not every venue in the database, which is what an empty `venueIds` would
 *    mean to `selectBriefEvents` on its own;
 *  - `tags` then narrows that to the venues the user filed under one of those
 *    tags (GOI-25), which is how "only this kind of thing" is expressed.
 *
 * Returning an empty array means "brief nothing" and the caller skips the
 * send — never "brief everything".
 */
export async function resolveBriefVenueIds(
  userId: string,
  venueIds: string[],
  tags: string[] = [],
  venues: UserVenueStore = defaultUserVenueStore,
): Promise<string[]> {
  const mine = await venues.listAll(userId);
  const picked = venueIds.length > 0 ? mine.filter((v) => venueIds.includes(v.id)) : mine;
  if (tags.length === 0) return picked.map((v) => v.id);
  const wanted = new Set(tags.map((t) => t.toLowerCase()));
  return picked
    .filter((v) => v.tags.some((t) => wanted.has(t.toLowerCase())))
    .map((v) => v.id);
}

/** Guard against double sends (e.g. a restart re-running the tick): skip
 *  subscriptions already sent within ~80% of their cadence period. */
export function wasRecentlySent(sub: NewsletterSubscription, now: Date): boolean {
  if (!sub.lastSentAt) return false;
  const periodMs = briefWindowDays(sub.frequency) * 24 * 3_600_000;
  return now.getTime() - new Date(sub.lastSentAt).getTime() < periodMs * 0.8;
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
    if (sub.frequency === 'weekly' && !isWeeklySendDay(now, sub.sendWeekday)) { skipped++; continue; }
    if (wasRecentlySent(sub, now)) { skipped++; continue; }
    try {
      const all = await defaultEventStore.listUpcoming({ limit: 500 });
      const venueIds = await resolveBriefVenueIds(sub.userId, sub.venueIds, sub.eventTags);
      // Nothing in scope — no venues followed, or no venue carries the chosen
      // tags. Either way an empty list must not fall through to "every venue
      // in the database".
      if (venueIds.length === 0) { skipped++; continue; }
      const events = selectBriefEvents(all, { ...sub, venueIds }, now);
      if (events.length === 0) { skipped++; continue; }
      await sendEmail({
        to: sub.email,
        subject: sub.frequency === 'daily' ? 'Goin — today at your venues' : 'Goin — your week ahead',
        html: renderBriefHtml(events, sub.frequency),
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

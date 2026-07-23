import type { Event, NewsletterFrequency } from '@goin/shared';
import { defaultEventStore } from './event-store.js';
import { sendEmail } from './email.js';
import { defaultNewsletterStore, type NewsletterStore, type NewsletterSubscription } from './newsletter-store.js';
import { msUntilNextWarsawTime } from './scheduler.js';
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

/**
 * Which events belong in a brief: within the cadence window, at one of the
 * chosen venues (empty selection = all), inside the after/before-hour window.
 */
export function selectBriefEvents(
  events: Event[],
  sub: Pick<NewsletterSubscription, 'venueIds' | 'afterHour' | 'beforeHour' | 'frequency'>,
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

/** True when `at` falls on the weekday weekly briefs go out (Monday, Warsaw). */
export function isWeeklySendDay(at: Date): boolean {
  const wd = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' }).format(at);
  return wd === 'Mon';
}

/** Guard against double sends (e.g. a restart re-running the tick): skip
 *  subscriptions already sent within ~80% of their cadence period. */
export function wasRecentlySent(sub: NewsletterSubscription, now: Date): boolean {
  if (!sub.lastSentAt) return false;
  const periodMs = briefWindowDays(sub.frequency) * 24 * 3_600_000;
  return now.getTime() - new Date(sub.lastSentAt).getTime() < periodMs * 0.8;
}

/**
 * One send sweep: daily subscriptions every day, weekly ones on Monday.
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
    if (sub.frequency === 'weekly' && !isWeeklySendDay(now)) { skipped++; continue; }
    if (wasRecentlySent(sub, now)) { skipped++; continue; }
    try {
      const all = await defaultEventStore.listUpcoming({ limit: 500 });
      const events = selectBriefEvents(all, sub, now);
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
 * In-process newsletter scheduler, same shape as the scrape scheduler: fires
 * daily at the configured Warsaw hour and re-arms. Weekly subscriptions are
 * filtered inside the sweep (Monday), so one daily tick serves both cadences.
 */
export function startNewsletterScheduler(opts: { hour?: number } = {}): { stop: () => void } {
  const hour = opts.hour ?? 8;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const arm = () => {
    if (stopped) return;
    const delay = msUntilNextWarsawTime(hour);
    console.log(`[newsletter] next send sweep in ${(delay / 3_600_000).toFixed(1)}h (daily at ${String(hour).padStart(2, '0')}:00 ${TZ})`);
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

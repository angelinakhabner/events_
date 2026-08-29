import type {
  Event, Festival, NewsletterCategoryRule, NewsletterDetail, NewsletterFrequency,
  NewsletterRuleCadence, NewsletterSendCadence,
} from '@afisz/shared';
import { deriveWindow, festivalsAtVenues, sendCadenceDays, timeFilterHour } from '@afisz/shared';
import { listFestivals } from '../data/festivals.js';
import { renderBriefHtml } from './newsletter-render.js';
import { defaultEventStore, type EventStore } from './event-store.js';
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
 */
export function selectBriefEvents(
  events: Event[],
  sub: BriefScope,
  now: Date = new Date(),
): Event[] {
  const horizon = new Date(now.getTime() + sub.windowDays * 24 * 3_600_000);
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
  store: NewsletterStore,
  wantToGo: WantToGoStore,
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
  reason?: 'not-due' | 'recently-sent' | 'no-venues' | 'no-events' | 'send-failed';
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
  /** The saved-events store the queue reads (GOI-101). Injected for tests. */
  wantToGo?: WantToGoStore;
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
        festival: currentFestival(venues.map((v) => v.name)),
        now,
      };
      await (opts.send ?? sendEmail)({
        to: sub.email,
        from: newsletterFromEmail(),
        subject: briefSubject(sections),
        html: renderBriefHtml(brief),
      });
      // By config id, not user id: a reader may hold one newsletter per folder
      // since GOI-100, and stamping the user would mark all of them sent.
      await store.markSent(sub.id, now);
      // After the send, never before (GOI-101): a failed send that had already
      // consumed the states would leave the reader never told, with the system
      // believing they had been.
      await recordWantToGoSent(sub.id, wantToGo, store, now);

      // File a PDF copy on any drive this user connected (GOI-91). After the
      // email and after `markSent` on purpose: `deliverBriefToDrives` never
      // throws, but ordering it here means that even if that changed, a drive
      // outage could not cost the subscriber the brief they were sent — nor
      // cause a retry to email it twice.
      const drives = opts.skipDrives
        ? []
        : await deliverBriefToDrives(sub.userId, brief, plannedFrequency(sub), {
            ...opts.drive,
            now,
          });
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

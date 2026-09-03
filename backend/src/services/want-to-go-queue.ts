import type { Event, EventChangeType, WantToGoState } from '@afisz/shared';
import { productionKey, wantToGoState } from '@afisz/shared';

/**
 * The "want to go" reminder queue (GOI-101).
 *
 * Not a digest section, and the difference matters. A digest section answers
 * "what is on"; this answers "you said you wanted to go to this, and it is
 * nearly time". It inherits no cadence, no depth and no derived window from
 * the category rules, it sits above every one of them in the issue, and it is
 * the only part of a brief that asks the reader to do something.
 *
 * Its whole design is in the dedup key. A saved play should be mentioned once
 * as `this_week`, again as `tomorrow`, and again as `last_chance` — three
 * different things to tell someone about one event — while never being
 * mentioned twice in the same state, however many issues fall inside its
 * horizon. A per-event "already sent" flag cannot express that: it can only
 * choose between repeating everything and saying each thing once. So the state
 * *is* the key, and `newsletter_sent_events` is keyed
 * `(config_id, event_id, state)`.
 */

/** One saved event, in the state this issue would report it in. */
export interface QueuedEvent {
  event: Event;
  state: WantToGoState;
}

/** One change to a saved event, as the issue reports it. */
export interface QueuedChange {
  event: Event;
  type: EventChangeType;
  oldValue: string | null;
  newValue: string | null;
}

export interface WantToGoSection {
  /** Escalating reminders, soonest first. */
  reminders: QueuedEvent[];
  /** Cancellations, reschedules and the rest — rendered above the reminders,
   *  since a cancelled event is news and an upcoming one is only a nudge. */
  changes: QueuedChange[];
}

/** True when there is nothing at all to say. */
export function isEmptySection(section: WantToGoSection): boolean {
  return section.reminders.length === 0 && section.changes.length === 0;
}

/** The dedup state a change is recorded under, so a rescheduled-then-cancelled
 *  event correctly reports both rather than only whichever came first. */
export function changeState(type: EventChangeType): string {
  return `change:${type}`;
}

export interface QueueScope {
  horizonDays: number;
  changesEnabled: boolean;
}

/**
 * Which of the reader's saved events this issue has something to say about,
 * before dedup.
 *
 * `siblings` — the other future occurrences of the same production — is what
 * "final performance" is measured against, and it is derived here from
 * `(venueId, title)` rather than from a productions table the schema does not
 * have. See `productionKey` for why, and for what that costs.
 */
export function queueCandidates(
  saved: Event[],
  scope: QueueScope,
  now: Date,
): QueuedEvent[] {
  const byProduction = new Map<string, Event[]>();
  for (const e of saved) {
    const key = productionKey(e);
    byProduction.set(key, [...(byProduction.get(key) ?? []), e]);
  }

  const queued: QueuedEvent[] = [];
  for (const event of saved) {
    const siblings = byProduction.get(productionKey(event)) ?? [event];
    const state = wantToGoState(event, siblings, now, scope.horizonDays);
    if (state) queued.push({ event, state });
  }
  return queued.sort((a, b) => a.event.startsAt.localeCompare(b.event.startsAt));
}

/**
 * What actually goes in the issue: the candidates this config has not already
 * reported *in that state*.
 *
 * `alreadySent` answers, per state, which event ids have gone out before. It
 * is passed in rather than fetched here so this stays a pure function — the
 * behaviour worth testing is the filtering, not the query.
 */
export function applyQueueDedup(
  candidates: QueuedEvent[],
  alreadySent: Map<string, Set<string>>,
): QueuedEvent[] {
  return candidates.filter((q) => !(alreadySent.get(q.state)?.has(q.event.id) ?? false));
}

/** The same, for the changes block. */
export function applyChangeDedup(
  changes: QueuedChange[],
  alreadySent: Map<string, Set<string>>,
): QueuedChange[] {
  return changes.filter(
    (c) => !(alreadySent.get(changeState(c.type))?.has(c.event.id) ?? false),
  );
}

/** The states a set of queued events occupies, for recording after a send. */
export function statesToRecord(
  queued: QueuedEvent[],
  changes: QueuedChange[],
): Map<string, string[]> {
  const byState = new Map<string, string[]>();
  const add = (state: string, id: string) =>
    byState.set(state, [...(byState.get(state) ?? []), id]);
  for (const q of queued) add(q.state, q.event.id);
  for (const c of changes) add(changeState(c.type), c.event.id);
  return byState;
}

/**
 * Whether a change is urgent enough to break the schedule for (GOI-101).
 *
 * Only a cancellation or a reschedule, and only within 48 hours: those are the
 * two that can leave someone standing outside a dark theatre. A sell-out is
 * disappointing rather than urgent, and a change three weeks out will keep
 * until the next issue.
 */
export const URGENT_WINDOW_HOURS = 48;

export function isUrgent(change: QueuedChange, now: Date): boolean {
  if (change.type !== 'cancelled' && change.type !== 'rescheduled') return false;
  const starts = new Date(change.event.startsAt).getTime();
  const ahead = starts - now.getTime();
  return ahead >= 0 && ahead <= URGENT_WINDOW_HOURS * 3_600_000;
}

/**
 * At most one off-schedule email per config per 12 hours.
 *
 * The rate limit is what makes urgent sends usable rather than a way to be
 * mailed six times in an afternoon when a festival cancels a day's programme.
 * Anything accumulating inside the window is not dropped — it simply waits and
 * goes out together in the next one, or in the next scheduled issue.
 */
export const URGENT_MIN_GAP_HOURS = 12;

export function urgentSendAllowed(lastUrgentAt: string | null, now: Date): boolean {
  if (!lastUrgentAt) return true;
  return now.getTime() - new Date(lastUrgentAt).getTime() >= URGENT_MIN_GAP_HOURS * 3_600_000;
}

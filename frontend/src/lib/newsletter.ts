import type { NewsletterDelivery } from '@afisz/shared';
import { pad } from './format';

/** Weekday names, JS convention (0=Sun … 6=Sat). */
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface BriefSummaryInput {
  /** Names of the venues the brief covers; empty means "all of them". */
  venueNames: string[];
  frequency: 'daily' | 'weekly' | 'monthly';
  sendHour: number;
  sendMinute: number;
  /** JS weekday, only meaningful for a weekly brief. */
  sendWeekday: number;
  /** "Only events after this hour", or null for no cutoff. */
  afterHour: number | null;
  /** Where it is sent. Blank until the reader types one. */
  email?: string;
  /** Email, a filed PDF, or both. Decides how the line names its destination
   *  — "emailed to ania@example.com" is a lie to a drive-only reader. */
  delivery?: NewsletterDelivery;
  /** A saved-but-switched-off brief sends nothing; the line has to say so. */
  enabled?: boolean;
}

/**
 * One sentence describing the brief the reader has actually set up (GOI-30),
 * covering all four of the things it decides (GOI-97).
 *
 * This line used to be a fixed example — "e.g. Kino Muranów and Kinoteka,
 * every day at 08:00, everything after 6 pm" — printed directly above controls
 * that said something else. Two statements of the same fact, one of them
 * fiction, is worse than one: a reader with the brief set to 15:00 read "every
 * day at 08:00" and had no way to tell which was true. So it is derived from
 * the live form state instead, and follows every edit.
 *
 * What it long stopped short of saying is what you would actually receive. It
 * named the venues and the send time and left the two questions people ask
 * first unanswered: *how much* is in it, and *where does it go*. The window is
 * the real content of the setting — "every day" and "once a month" are not two
 * rhythms of the same email, they are 24 hours of listings versus 30 days of
 * them — and the address is the one field a typo makes silently useless. Both
 * are stated outright now, along with the cutoff and, when the brief is
 * switched off, the fact that nothing is being sent at all.
 *
 * It names three venues at most — the point is to recognise your own setup at
 * a glance, and a list of fourteen is not read, it's skipped.
 */
export function briefSummary(input: BriefSummaryInput): string {
  const where = venuePhrase(input.venueNames);
  const when = `${cadence(input)} at ${pad(input.sendHour)}:${pad(input.sendMinute)}`;
  const only = input.afterHour == null ? '' : ` — only what starts after ${pad(input.afterHour)}:00`;
  const line =
    `${horizon(input.frequency)} at ${where}, ${destination(input)} ${when}${only}.`;
  // Capitalised by the horizon phrase, which always leads.
  return input.enabled === false ? `${line} Paused — nothing is being sent.` : line;
}

/**
 * How much of the calendar the brief reaches, in the words the sweep means by
 * it: `briefWindowDays` on the backend turns the cadence into 1, 7 or 30 days
 * of upcoming events, so the line says days rather than repeating the cadence.
 */
function horizon(frequency: BriefSummaryInput['frequency']): string {
  if (frequency === 'daily') return 'The next 24 hours';
  if (frequency === 'weekly') return 'The next 7 days';
  return 'The next 30 days';
}

/**
 * Where the brief actually goes.
 *
 * The line named an address unconditionally, which was right while email was
 * the only delivery there was and false the moment a reader could choose to
 * have it filed instead. The same reasoning as GOI-30: two statements of one
 * fact, with one of them fiction, is worse than one statement.
 */
function destination(input: BriefSummaryInput): string {
  const delivery = input.delivery ?? 'email';
  if (delivery === 'drive') return 'filed to your drive as a PDF';
  const to = `emailed to ${recipient(input.email)}`;
  return delivery === 'both' ? `${to} and filed to your drive` : to;
}

/** The address, or a placeholder while the field is still empty. */
function recipient(email: string | undefined): string {
  const trimmed = email?.trim();
  return trimmed ? trimmed : 'your inbox';
}

function venuePhrase(names: string[]): string {
  if (names.length === 0) return 'all your venues';
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

function cadence({ frequency, sendWeekday }: BriefSummaryInput): string {
  if (frequency === 'daily') return 'every day';
  if (frequency === 'monthly') return 'once a month';
  return `every ${WEEKDAY_NAMES[sendWeekday] ?? 'Monday'}`;
}

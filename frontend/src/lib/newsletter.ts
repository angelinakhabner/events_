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
}

/**
 * One sentence describing the brief the reader has actually set up (GOI-30).
 *
 * This line used to be a fixed example — "e.g. Kino Muranów and Kinoteka,
 * every day at 08:00, everything after 6 pm" — printed directly above controls
 * that said something else. Two statements of the same fact, one of them
 * fiction, is worse than one: a reader with the brief set to 15:00 read "every
 * day at 08:00" and had no way to tell which was true.
 *
 * So it is derived from the live form state instead, and follows every edit.
 * It names three venues at most — the point is to recognise your own setup at
 * a glance, and a list of fourteen is not read, it's skipped.
 */
export function briefSummary(input: BriefSummaryInput): string {
  const where = venuePhrase(input.venueNames);
  const when = `${cadence(input)} at ${pad(input.sendHour)}:${pad(input.sendMinute)}`;
  const only = input.afterHour == null ? '' : `, everything after ${pad(input.afterHour)}:00`;
  return `Get what's on at ${where} as an email brief — ${when}${only}.`;
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

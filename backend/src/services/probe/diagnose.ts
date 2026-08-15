import type { ProbeErrorCode } from '@afisz/shared';
import { dateDensity, visibleText } from './heuristic.js';

/**
 * Why did the ladder find nothing? (GOI-72 §3F)
 *
 * A single `NO_EVENTS_FOUND` for every miss is what makes the current check
 * button useless: "we couldn't read it" tells the user nothing about whether to
 * paste a different link, wait, or give up. Each branch below is a different
 * next action, which is the only reason to distinguish them.
 *
 * Runs on markup we already have. It makes no requests and calls no model.
 */

/** Below this much visible text there is nothing for a reader — human or
 *  model — which in practice means the body arrives via JavaScript. */
const MIN_TEXT_CHARS = 2_000;

/** Mount points and hydration payloads: an app shell, not a document. */
const SPA_MARKERS = [
  '__NEXT_DATA__',
  '__NUXT__',
  'id="root"',
  "id='root'",
  'id="app"',
  "id='app'",
  'ng-app',
];

export interface Diagnosis {
  code: Extract<
    ProbeErrorCode,
    'JS_RENDERED_NEEDS_PAID' | 'NOT_HTML' | 'PAST_EVENTS_ONLY' | 'NO_EVENTS_FOUND'
  >;
}

export function diagnose(args: {
  html: string;
  contentType: string;
  locale: 'pl' | 'en';
  now: Date;
}): Diagnosis {
  if (args.contentType.includes('application/pdf')) return { code: 'NOT_HTML' };

  const text = visibleText(args.html);

  if (text.length < MIN_TEXT_CHARS && looksClientRendered(args.html)) {
    return { code: 'JS_RENDERED_NEEDS_PAID' };
  }

  // Dates are present but the heuristic gate still failed, or dates are present
  // and every one of them has been and gone: the venue publishes a programme,
  // it just isn't a future one. That's an archive page, and telling the user so
  // invites them to paste the current one.
  const density = dateDensity(text, args.locale);
  if (density.anyDates && allDatesPast(text, args.now)) return { code: 'PAST_EVENTS_ONLY' };

  return { code: 'NO_EVENTS_FOUND' };
}

function looksClientRendered(html: string): boolean {
  if (SPA_MARKERS.some((m) => html.includes(m))) return true;
  return /<noscript[^>]*>[\s\S]{0,400}?(enable|włącz)\s+(java)?script/i.test(html);
}

/**
 * Every four-digit year and numeric date on the page is in the past.
 *
 * Deliberately conservative: it only fires when the page carries explicit years
 * and *none* of them reaches the current one. A listing that writes "12
 * września" with the year only in the page furniture stays `NO_EVENTS_FOUND`
 * rather than being mislabelled as an archive.
 */
export function allDatesPast(text: string, now: Date): boolean {
  const years = [...text.matchAll(/\b(19|20)\d{2}\b/g)]
    .map((m) => Number(m[0]))
    // Ignore the copyright line, which is "now" on every site and would
    // otherwise veto the whole check.
    .filter((y) => y >= 1990 && y <= now.getUTCFullYear() + 5);

  if (years.length === 0) return false;
  return Math.max(...years) < now.getUTCFullYear();
}

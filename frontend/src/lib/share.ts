import type { Event } from '@afisz/shared';
import { DEFAULT_SHARE_TEMPLATE, renderShareTemplate } from '@afisz/shared';
import { formatEventTime, formatShortDate } from './format';
import { isAllDay } from './buckets';

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

interface ShareDeps {
  share?: (data: ShareData) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

/** Anything `inviteText` needs off an event. Only the venue's *name* is used,
 *  so the settings preview can pass a stand-in without inventing an id. */
type ShareableEvent = Pick<Event, 'title' | 'sourceUrl' | 'category' | 'startsAt'> & {
  venue?: { name: string } | null;
};

/**
 * What lands in the other person's chat window (GOI-49).
 *
 * Sharing an event is an invitation, not a citation, so the message is written
 * as one rather than the bare "X @ Y" it used to paste. Whoever receives it
 * should be able to answer yes without opening the link first, which is why
 * the when is in the sentence and not only behind the URL.
 *
 * The wording is the user's: logged-in readers can rewrite the template under
 * /my → Settings, and `template` carries whatever they saved. `{venue}` and
 * `{when}` substitute *with* their own leading wording and vanish entirely
 * when the event has neither — which is what lets one template cover a film
 * with a showtime, a museum run with only a day, and a tracked film with
 * neither, without leaving a dangling "at" behind.
 *
 * Museums get the day without an hour: they publish runs, not showtimes, and
 * their undated rows carry a placeholder midnight (GOI-53) that would read as
 * an invitation to meet at midnight.
 */
export function inviteText(event: ShareableEvent, template = DEFAULT_SHARE_TEMPLATE): string {
  return renderShareTemplate(template, {
    title: event.title,
    venue: event.venue?.name ? ` at ${event.venue.name}` : '',
    when: whenPhrase(event),
  });
}

/** " — Sat 4 Jul, 20:00", or just the day for an all-day run. Empty when the
 *  event carries no usable date at all (a tracked film, say). */
function whenPhrase(event: ShareableEvent): string {
  if (!event.startsAt || Number.isNaN(Date.parse(event.startsAt))) return '';
  const day = `${weekdayFmt.format(new Date(event.startsAt))} ${formatShortDate(event.startsAt)}`;
  return isAllDay(event) ? ` — ${day}` : ` — ${day}, ${formatEventTime(event)}`;
}

const weekdayFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  timeZone: 'Europe/Warsaw',
});

/** Share the event using Web Share API when available, otherwise copy a
 *  text payload to the clipboard. Returns a tagged outcome so the UI can
 *  show "Copied!" / "Shared!" / nothing. */
export async function shareEvent(
  event: ShareableEvent,
  deps: ShareDeps = {},
  template?: string,
): Promise<ShareOutcome> {
  return shareLink({ title: event.title, text: inviteText(event, template), url: event.sourceUrl }, deps);
}

/** Hand a URL to the platform share sheet, falling back to the clipboard.
 *  Used for events and, since GOI-47, for a "want to go" list's share link. */
export async function shareLink(
  payload: { title: string; text: string; url: string },
  deps: ShareDeps = {},
): Promise<ShareOutcome> {
  const { title, text, url } = payload;

  const share = deps.share ?? (typeof navigator !== 'undefined' && navigator.share ? navigator.share.bind(navigator) : undefined);
  if (share) {
    try {
      await share({ title, text, url });
      return 'shared';
    } catch (e) {
      // User aborted the share sheet → AbortError. Don't fall through to
      // clipboard in that case; that would silently copy after a deliberate
      // dismiss.
      if (e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message))) {
        return 'cancelled';
      }
      // Some browsers throw NotAllowedError when not from a user gesture.
      // Fall through to clipboard in that case.
    }
  }

  const writeText =
    deps.writeText ??
    (typeof navigator !== 'undefined' && navigator.clipboard?.writeText
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : undefined);
  if (!writeText) return 'failed';

  try {
    await writeText(`${text}\n${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** The absolute URL a shared "want to go" list lives at. Built off Vite's
 *  BASE_URL because the site is served from a subpath on Pages (`/events_/`,
 *  and `/events_/dev/` for the preview build). */
export function sharedListUrl(token: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return new URL(`${base}/list/${token}`, window.location.origin).toString();
}

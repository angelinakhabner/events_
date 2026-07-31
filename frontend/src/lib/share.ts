import type { Event } from '@afisz/shared';

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

interface ShareDeps {
  share?: (data: ShareData) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

/** Share the event using Web Share API when available, otherwise copy a
 *  text payload to the clipboard. Returns a tagged outcome so the UI can
 *  show "Copied!" / "Shared!" / nothing. */
export async function shareEvent(event: Pick<Event, 'title' | 'sourceUrl' | 'venue'>, deps: ShareDeps = {}): Promise<ShareOutcome> {
  const venuePart = event.venue?.name ? ` @ ${event.venue.name}` : '';
  return shareLink({ title: event.title, text: `${event.title}${venuePart}`, url: event.sourceUrl }, deps);
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

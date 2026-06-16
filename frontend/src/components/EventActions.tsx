import { useState } from 'react';
import type { Event, Venue } from '@goin/shared';
import { downloadIcs, googleCalendarUrl, invitationText } from '../lib/calendar';

interface Props {
  event: Event;
  venue: Venue | undefined;
}

const btn =
  'inline-flex items-center gap-1.5 rounded-full border border-rule px-3 py-1.5 ' +
  'text-xs text-muted no-underline transition-colors hover:border-accent hover:text-accent';

/**
 * Per-event "invite a friend" actions for the logged-out view: add to Google
 * Calendar / iCal, plus a share button framed as a friendly invitation.
 */
export function EventActions({ event, venue }: Props) {
  const [shared, setShared] = useState(false);

  async function handleShare() {
    const text = invitationText(event, venue);
    const shareData = { title: event.title, text, url: event.sourceUrl };
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(shareData);
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(`${text} ${event.sourceUrl}`);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {
      /* user cancelled the share sheet, or copy failed — nothing to do */
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="tag mr-1">Invite a friend</span>
      <a
        href={googleCalendarUrl(event, venue)}
        target="_blank"
        rel="noreferrer"
        className={btn}
        onClick={(e) => e.stopPropagation()}
      >
        Google Calendar
      </a>
      <button
        type="button"
        className={btn}
        onClick={(e) => {
          e.stopPropagation();
          downloadIcs(event, venue);
        }}
      >
        iCal (.ics)
      </button>
      <button
        type="button"
        className={btn}
        onClick={(e) => {
          e.stopPropagation();
          void handleShare();
        }}
        aria-label={`Invite a friend to "${event.title}"`}
      >
        {shared ? 'Invitation copied!' : 'Share invite'}
      </button>
    </div>
  );
}

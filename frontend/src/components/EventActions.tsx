import { useEffect, useState } from 'react';
import type { Event } from '@afisz/shared';
import { shareEvent, type ShareOutcome } from '../lib/share';
import { trpc } from '../lib/trpc';
import { isLoggedIn } from '../lib/auth';
import { AddToCalendar } from './AddToCalendar';
import { ClosestScreenings } from './ClosestScreenings';

/**
 * Per-event "nearest screenings" + "add to calendar" + "share" actions (+
 * "want to go" when logged in). Shared by the logged-out Home view
 * (EventBuckets) and the saved-folders view (EventCard) so the per-event
 * action UI stays in one place.
 *
 * The screenings panel is where films get onto your want-to-go list (GOI-26),
 * so it has to be reachable from a real event — it is the only entry point.
 */
export function EventActions({ event }: { event: Event }) {
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-4 md:gap-[22px]">
      {isLoggedIn() ? <WantToGoButton event={event} /> : null}
      <ClosestScreenings event={event} />
      <AddToCalendar event={event} />
      <ShareButton event={event} />
    </div>
  );
}

function WantToGoButton({ event }: { event: Event }) {
  const utils = trpc.useUtils();
  const ids = trpc.my.wantToGo.ids.useQuery();
  const saved = !!ids.data?.includes(event.id);

  const invalidate = () => {
    utils.my.wantToGo.ids.invalidate();
    utils.my.wantToGo.list.invalidate();
  };
  const add = trpc.my.wantToGo.add.useMutation({ onSuccess: invalidate });
  const remove = trpc.my.wantToGo.remove.useMutation({ onSuccess: invalidate });
  const busy = add.isPending || remove.isPending;

  return (
    <button
      type="button"
      aria-pressed={saved}
      disabled={busy}
      onClick={() => (saved ? remove.mutate({ eventId: event.id }) : add.mutate({ eventId: event.id }))}
      className={`act act-sm md:text-[13px] ${saved ? 'act-on' : ''}`}
    >
      {saved ? '♥ Going' : '♡ Want to go'}
    </button>
  );
}

function ShareButton({ event }: { event: Event }) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);

  // Auto-clear the small toast after a beat so it doesn't pile up.
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(() => setOutcome(null), 1800);
    return () => clearTimeout(t);
  }, [outcome]);

  const onClick = async () => {
    const result = await shareEvent(event);
    if (result !== 'cancelled') setOutcome(result);
  };

  const flash =
    outcome === 'copied' ? 'Link copied' :
    outcome === 'shared' ? 'Shared' :
    outcome === 'failed' ? "Couldn't share" :
    null;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        className="act act-sm md:text-[13px]"
      >
        Share
      </button>
      {flash ? (
        <span role="status" aria-live="polite" className="text-[11px] text-faint">
          {flash}
        </span>
      ) : null}
    </span>
  );
}

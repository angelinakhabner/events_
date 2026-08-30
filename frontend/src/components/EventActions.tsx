import { useEffect, useState } from 'react';
import { isExhibition, type Event } from '@afisz/shared';
import { shareEvent, type ShareOutcome } from '../lib/share';
import { trpc } from '../lib/trpc';
import { isLoggedIn } from '../lib/auth';
import { AddToCalendar } from './AddToCalendar';
import { ScreeningsStrip } from './ScreeningsStrip';

/**
 * Per-event "nearest screenings" + "add to calendar" + "share" actions (+
 * "want to go" when logged in). Shared by the logged-out Home view
 * (EventBuckets) and the saved-folders view (EventCard) so the per-event
 * action UI stays in one place.
 *
 * The screenings strip is where films get onto your want-to-go list (GOI-26),
 * so it has to be reachable from a real event — it is the only entry point.
 *
 * It is the same strip /my uses (GOI-55) and opens inline beneath the row, so
 * the row aligns on the baseline of its first line: the other buttons keep
 * their line while the strip expands beneath them, instead of centring
 * themselves against it.
 *
 * `act-row` carries the type size for every button in the row (GOI-63) — they
 * each used to set their own, and had drifted a pixel apart.
 */
export function EventActions({ event }: { event: Event }) {
  return (
    <div className="act-row mt-3.5 gap-x-4 md:gap-x-[22px]">
      {isLoggedIn() ? <WantToGoButton event={event} /> : null}
      {/* The showing you are reading sits right above this, so the strip
          offers the *other* ones. An exhibition has none: it runs continuously,
          so "nearest dates" would offer the same answer as the row itself
          (GOI-67). */}
      {isExhibition(event) ? null : <ScreeningsStrip event={event} includeSelf={false} canTrack />}
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
      className={`act act-inherit ${saved ? 'act-on' : ''}`}
    >
      <StableLabel widest={WANT_TO_GO}>{saved ? GOING : WANT_TO_GO}</StableLabel>
    </button>
  );
}

const WANT_TO_GO = '♡ Want to go';
const GOING = '♥ Going';

/**
 * A label that keeps its width when its text changes (GOI-62).
 *
 * "♡ Want to go" and "♥ Going" differ by five characters, and this button is
 * the first item in a `flex flex-wrap` row. On a desktop row with space to
 * spare, that difference is absorbed by the gap after it. On a phone, where
 * the row is already wrapping, it is not: pressing the button re-measures
 * every item after it, so "Nearest screenings", "Add to calendar" and "Share"
 * hop between lines — and the button itself, having shrunk, is left sitting
 * away from the buttons it is supposed to sit beside. The reported symptom
 * was the button moving and losing its alignment; the cause was the row
 * reflowing underneath it.
 *
 * So the wider of the two labels is rendered, invisible, to hold the width,
 * and the live one is laid over it. The sizer stays in normal flow, which is
 * what keeps the button's baseline fixed too — `.act-row` aligns on baselines,
 * and an absolutely-positioned label alone would have none to contribute.
 */
function StableLabel({ widest, children }: { widest: string; children: string }) {
  return (
    <span className="relative inline-block whitespace-nowrap">
      <span aria-hidden className="invisible">{widest}</span>
      <span className="absolute inset-0 text-left">{children}</span>
    </span>
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
        className="act act-inherit"
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

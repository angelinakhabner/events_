import { useEffect, useRef, useState } from 'react';
import type { Event } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { formatShortDate, formatTime } from '../lib/format';

const MAX_SHOWN = 6;

/**
 * "Nearest screenings" — cinema events only. Opens a dropdown listing the
 * soonest upcoming screenings of the same film across all cinemas, nearest
 * first, so you can pick whichever showing suits you.
 *
 * The panel (and its query) only mounts once opened, so cards don't fire a
 * request per event and the button stays safe to render outside a tRPC
 * provider in unit tests.
 */
export function ClosestScreenings({ event }: { event: Event }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape so the inline panel doesn't get stuck open.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (event.category !== 'cinema') return null;

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0"
      >
        Nearest screenings
      </button>
      {open ? <ScreeningsPanel event={event} /> : null}
    </div>
  );
}

function ScreeningsPanel({ event }: { event: Event }) {
  const screenings = trpc.events.screenings.useQuery({ title: event.title });
  // The row you clicked from is already on screen — list the alternatives.
  const others = (screenings.data ?? []).filter((s) => s.id !== event.id).slice(0, MAX_SHOWN);

  let body;
  if (screenings.isLoading) {
    body = <div className="text-sm text-muted">Looking for screenings…</div>;
  } else if (screenings.isError) {
    body = <div className="text-sm text-muted">Couldn’t load screenings.</div>;
  } else if (others.length === 0) {
    body = <div className="text-sm text-muted">No other upcoming screenings.</div>;
  } else {
    body = (
      <ul className="divide-y divide-rule list-none m-0 p-0">
        {others.map((s) => (
          <li key={s.id}>
            <a
              href={s.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-baseline gap-3 py-1.5 text-sm text-ink hover:text-accent no-underline"
            >
              <span className="shrink-0 tabular-nums text-muted">
                {formatShortDate(s.startsAt)} · {formatTime(s.startsAt)}
              </span>
              <span className="truncate">{s.venue?.name ?? 'Unknown venue'}</span>
            </a>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="absolute z-10 left-0 mt-2 bg-paper border border-rule p-3 min-w-[16rem] max-w-[22rem]">
      <div className="text-xs uppercase tracking-wide text-muted mb-2">Nearest screenings</div>
      {body}
    </div>
  );
}

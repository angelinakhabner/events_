import { useState } from 'react';
import type { Event } from '@afisz/shared';
import { ExpandableText } from './ExpandableText';

/**
 * What a listing row says about the work.
 *
 * - The short description, as before. Where the writer also produced a long
 *   one (GOI-139), "Read more" swaps it in — the short sentence stays the thing
 *   you scan, the paragraph is there when you want to decide.
 * - A theatre show with no description at all (GOI-136): say so, and point at
 *   the venue's own page for it, rather than leaving a gap that reads as a
 *   broken row. Theatre only: that is where the gaps were reported, and a
 *   cinema day of twenty bare screenings does not need twenty notices.
 */
export function EventDescription({ event, venueName }: { event: Event; venueName?: string }) {
  const [open, setOpen] = useState(false);
  const short = event.description?.trim();
  const long = event.descriptionLong?.trim();

  if (!short) {
    if (event.category !== 'theatre') return null;
    return (
      <p className="mt-2.5 text-sm text-muted">
        Brak opisu —{' '}
        <a href={event.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-accent">
          o tym spektaklu na stronie {venueName ? venueName : 'miejsca'} ↗
        </a>
      </p>
    );
  }

  if (!long || long === short) return <ExpandableText text={short} className="mt-2.5" />;

  return (
    <div className="mt-2.5">
      <p className="text-sm md:text-base text-body max-w-[640px]">{open ? long : short}</p>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="mt-1.5 act act-sm act-on"
      >
        {open ? 'Zwiń' : 'Czytaj dalej'}
      </button>
    </div>
  );
}

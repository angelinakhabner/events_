import { useEffect, useMemo, useRef, useState } from 'react';
import { VenuePickerModal } from './VenuePickerModal';
import type { VenueFilterOption, VenueFilterStatus } from '@afisz/shared';
import { venueStatusNote } from '@afisz/shared';

/**
 * The fourth filter row: which venues, under the selected category (GOI-76).
 *
 * Not a new UI concept — it is a fourth instance of the row the user already
 * reads three times above it, at the same type scale and spacing. One thing is
 * deliberately different, and it has to be: day and time are single-select
 * because their options are mutually exclusive, while "Muranów *and* Iluzjon"
 * is an ordinary request. Position alone won't teach anyone that, so a
 * selected venue is **filled** and an unselected one is **outline**, which is
 * the app's existing vocabulary for "several of these can be on at once".
 */

export interface VenueBarProps {
  venues: VenueFilterOption[];
  /** Selected venue ids for the current category; empty means "all". */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Hidden entirely on the ALL tab — see below. */
  category: string | null;
  loading?: boolean;
  /** Passed to the picker so it can drop the "log in to add venues" hint. */
  signedIn?: boolean;
}

export function VenueBar({ venues, selected, onChange, category, loading, signedIn }: VenueBarProps) {
  // §4: sixteen-plus chips is not a row, and someone on ALL is browsing rather
  // than narrowing. Hiding is the decision, not a limitation.
  if (category === null) return null;
  if (!loading && venues.length === 0) return null;

  return (
    <Row
      venues={venues}
      selected={selected}
      onChange={onChange}
      category={category}
      signedIn={signedIn}
    />
  );
}

function Row({ venues, selected, onChange, category, signedIn }: Omit<VenueBarProps, 'loading'>) {
  const order = useStableOrder(venues, category);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [picking, setPicking] = useState(false);

  const byId = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues]);
  const ordered = order.map((id) => byId.get(id)).filter((v): v is VenueFilterOption => !!v);
  const total = venues.reduce((sum, v) => sum + v.count, 0);
  const all = selected.length === 0;

  /**
   * §1. The first click on a venue *solos* it rather than adding to "all" —
   * the common case is "just show me Muranów", and that has to be one click,
   * not one click and five deselections.
   */
  const toggle = (id: string) => {
    if (all) return onChange([id]);
    if (selected.includes(id)) return onChange(selected.filter((x) => x !== id));
    onChange([...selected, id]);
  };

  // §7: left/right walk the row, so it is usable without a pointer.
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = index + (e.key === 'ArrowRight' ? 1 : -1);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="group"
      aria-label="Filter by venue"
      className="scroll-x flex flex-nowrap md:flex-wrap items-center gap-x-4 gap-y-2 pb-3"
    >
      {/* GOI-89: this one opens the full list rather than clearing the
          selection outright. The row can only ever show the busiest few, and
          it names venues without saying what they are — "Edito" means nothing
          until you see edito.pl beside it. Clearing is still one click, now
          the first row of the dialog.

          The label and the count are unchanged, and deliberately so: GOI-76 §2
          fixed that number as the *unfiltered* total, so it stays a stable
          reading of "what's on in this category" rather than echoing the
          selection back. */}
      <button
        ref={(el) => { refs.current[0] = el; }}
        type="button"
        aria-pressed={all}
        aria-haspopup="dialog"
        aria-expanded={picking}
        onClick={() => setPicking(true)}
        onKeyDown={(e) => onKeyDown(e, 0)}
        className={chipClass(all, false)}
      >
        All venues <span className="opacity-70">{total}</span>
        <span aria-hidden className="ml-1.5 text-[8px] align-middle">▼</span>
      </button>

      {ordered.map((v, i) => (
        <VenueChip
          key={v.id}
          ref={(el) => { refs.current[i + 1] = el; }}
          venue={v}
          pressed={selected.includes(v.id)}
          onClick={() => toggle(v.id)}
          onKeyDown={(e) => onKeyDown(e, i + 1)}
        />
      ))}

      {picking ? (
        <VenuePickerModal
          venues={venues}
          selected={selected}
          category={category ?? ''}
          signedIn={signedIn}
          onApply={(next) => {
            onChange(next);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : null}
    </div>
  );
}

const VenueChip = ({
  ref,
  venue,
  pressed,
  onClick,
  onKeyDown,
}: {
  ref: (el: HTMLButtonElement | null) => void;
  venue: VenueFilterOption;
  pressed: boolean;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) => {
  const note = venueStatusNote(venue.status, venue.count, venue.lastScrapedAt);
  const dimmed = venue.count === 0 || venue.status !== 'active';

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      onKeyDown={onKeyDown}
      // §7: the count belongs in the accessible name, and the status has to be
      // readable as text — a grey chip says nothing to a screen reader, and
      // says nothing to anyone who can't tell this grey from that grey.
      aria-label={`${venue.name}, ${venue.count} event${venue.count === 1 ? '' : 's'}${
        note ? `. ${note}` : ''
      }`}
      aria-description={note ?? undefined}
      title={note ?? undefined}
      className={chipClass(pressed, dimmed)}
    >
      {venue.name}{' '}
      <span className={venue.status === 'dark' ? 'line-through opacity-70' : 'opacity-70'}>
        {venue.count}
      </span>
      {/* A stale venue's number is not wrong so much as old; the dot is the
          quietest way to say "this one hasn't been read lately". */}
      {venue.status === 'stale' ? <span aria-hidden className="ml-1 text-[8px] align-middle">●</span> : null}
    </button>
  );
};

/** Filled when selected, outline when not — the multi-select tell. */
function chipClass(pressed: boolean, dimmed: boolean): string {
  const base =
    'shrink-0 border-2 px-3 py-1.5 text-[11px] md:text-xs font-extrabold uppercase tracking-[0.5px] cursor-pointer';
  if (pressed) return `${base} border-ink bg-ink text-white`;
  return `${base} border-ink bg-transparent hover:text-accent hover:border-accent ${
    dimmed ? 'text-faint' : 'text-ink'
  }`;
}

/**
 * §3. Freeze the chip order for as long as the user stays in one category.
 *
 * Sorting in the render path would reorder the row on every date click, and a
 * filter row whose chips move as you use it is unusable — the thing you were
 * about to click is somewhere else by the time you click. So the order is
 * derived once per category and counts are indexed into it; only a category
 * change re-sorts.
 */
export function useStableOrder(venues: VenueFilterOption[], category: string | null): string[] {
  const [order, setOrder] = useState<string[]>([]);
  const key = useRef<string | null>(null);

  useEffect(() => {
    const ids = venues.map((v) => v.id).join(',');
    // Re-sort on a category change, and on the first load for that category
    // (the venue set arrives after the category does).
    const signature = `${category ?? 'all'}::${ids}`;
    if (key.current === signature) return;
    key.current = signature;
    setOrder(
      [...venues]
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .map((v) => v.id),
    );
  }, [venues, category]);

  // Before the effect runs, fall back to the incoming order so the first paint
  // isn't empty.
  return order.length > 0 ? order : venues.map((v) => v.id);
}

export type { VenueFilterStatus };

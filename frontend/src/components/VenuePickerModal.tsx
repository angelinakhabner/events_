import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { VenueFilterOption } from '@afisz/shared';
import { venueStatusNote } from '@afisz/shared';

/**
 * The venue picker behind the "All venues" chip (GOI-89).
 *
 * The chip row above it is a *filter* — a handful of the busiest venues, kept
 * short and stable so it stays usable while you click around. This is the
 * other half: every venue under the current category, with its address, so a
 * name that means nothing on its own ("Edito") can still be identified, and
 * so someone can go straight to the source.
 *
 * Selection is applied on submit rather than per click. The row is the place
 * for one quick change; someone who opened this is picking several, and
 * re-filtering the feed under them after every checkbox is the behaviour that
 * makes a list like this unusable.
 */

export interface VenuePickerModalProps {
  venues: VenueFilterOption[];
  /** Currently selected ids; empty means "all venues". */
  selected: string[];
  onApply: (next: string[]) => void;
  onCancel: () => void;
  /** Shown in the heading so the dialog says what it is scoped to. */
  category: string;
  /** Hides the "log in to add venues" hint for someone already logged in. */
  signedIn?: boolean;
}

export function VenuePickerModal({
  venues,
  selected,
  onApply,
  onCancel,
  category,
  signedIn,
}: VenuePickerModalProps) {
  const [draft, setDraft] = useState<string[]>(selected);
  const [query, setQuery] = useState('');
  const titleId = useId();
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // A list this long is worth searching, and the search box is the one control
  // someone opening this dialog is most likely to want first.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return venues;
    return venues.filter(
      (v) => v.name.toLowerCase().includes(q) || v.url.toLowerCase().includes(q),
    );
  }, [venues, query]);

  const toggle = (id: string) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  const allSelected = draft.length === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/70 px-4 py-10 md:py-16"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-xl flex-col border-4 border-ink bg-panel"
      >
        <div className="border-b-3 border-ink p-6 md:px-8">
          <h2 id={titleId} className="font-display text-[28px] md:text-[32px] uppercase m-0">
            {category} venues
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            {venues.length} venue{venues.length === 1 ? '' : 's'} · pick the ones you want in the
            feed, or leave it on all.
          </p>

          <label className="sr-only" htmlFor={searchId}>
            Search venues
          </label>
          <input
            id={searchId}
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or address"
            className="mt-4 w-full border-2 border-ink bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="m-0 list-none p-0">
            <li className="border-b-2 border-divider">
              <button
                type="button"
                onClick={() => setDraft([])}
                aria-pressed={allSelected}
                className={`flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-6 py-3 text-left md:px-8 ${
                  allSelected ? 'text-accent' : 'text-ink hover:text-accent'
                }`}
              >
                <Tick on={allSelected} />
                <span className="text-[13px] font-extrabold uppercase tracking-[0.5px]">
                  All venues
                </span>
              </button>
            </li>

            {matches.map((v) => {
              const on = draft.includes(v.id);
              const note = venueStatusNote(v.status, v.count, v.lastScrapedAt);
              return (
                <li key={v.id} className="border-b-2 border-divider last:border-b-0">
                  <div className="flex items-start gap-3 px-6 py-3 md:px-8">
                    <button
                      type="button"
                      onClick={() => toggle(v.id)}
                      aria-pressed={on}
                      aria-label={`${v.name}, ${v.count} event${v.count === 1 ? '' : 's'}${
                        note ? `. ${note}` : ''
                      }`}
                      className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 border-0 bg-transparent p-0 text-left"
                    >
                      <Tick on={on} />
                      <span className="min-w-0">
                        <span
                          className={`block text-sm font-extrabold ${on ? 'text-accent' : 'text-ink'}`}
                        >
                          {v.name}{' '}
                          <span className={v.status === 'dark' ? 'line-through opacity-60' : 'opacity-60'}>
                            {v.count}
                          </span>
                        </span>
                        {note ? <span className="block text-xs text-muted">{note}</span> : null}
                      </span>
                    </button>
                    {/* Outside the toggle button: a link inside a button is
                        neither clickable as a link nor valid markup. */}
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 text-xs text-muted underline hover:text-accent"
                    >
                      {hostOf(v.url)}
                    </a>
                  </div>
                </li>
              );
            })}

            {matches.length === 0 ? (
              <li className="px-6 py-6 text-sm text-muted md:px-8">
                No venue matches “{query}”.
              </li>
            ) : null}
          </ul>
        </div>

        <div className="border-t-3 border-ink p-6 md:px-8">
          {/* GOI-89: the list is what this venue set *is*; adding to it is a
              different, logged-in job, and this is where someone asks the
              question. */}
          {signedIn ? null : (
            <p className="mb-4 text-sm text-muted">
              To add venues,{' '}
              <a href="/my?section=venues" className="underline hover:text-accent">
                log in to My venues
              </a>
              .
            </p>
          )}
          <div className="flex flex-col gap-3.5 md:flex-row">
            <button type="button" onClick={() => onApply(draft)} className="btn-fill text-center">
              {allSelected
                ? 'Show all venues'
                : `Show ${draft.length} venue${draft.length === 1 ? '' : 's'}`}
            </button>
            <button type="button" onClick={onCancel} className="btn-outline text-center">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A square that fills when on — the app's checkbox, in its own vocabulary. */
function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 inline-block h-4 w-4 shrink-0 border-2 border-ink ${
        on ? 'bg-ink' : 'bg-transparent'
      }`}
    />
  );
}

/** `kinomuranow.pl` — the address without the noise, since the row is narrow. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

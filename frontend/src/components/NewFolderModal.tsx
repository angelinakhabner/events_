import { useState, useId, useEffect } from 'react';
import type { Category, EventFilters, Venue } from '@goin/shared';

const CATEGORIES: Category[] = ['cinema', 'theatre', 'exhibition', 'comedy'];

export interface NewFolderPayload {
  name: string;
  venueIds: string[];
  filters: EventFilters;
}

interface Props {
  venues: Venue[];
  onCancel: () => void;
  onSubmit: (payload: NewFolderPayload) => void;
  submitting?: boolean;
  serverError?: string | null;
}

export function NewFolderModal({ venues, onCancel, onSubmit, submitting, serverError }: Props) {
  const [name, setName] = useState('');
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) { setError('Give your folder a name.'); return; }
    onSubmit({
      name: trimmed,
      venueIds,
      filters: categories.length ? { categories } : {},
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-4 py-16"
      onClick={onCancel}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg bg-paper p-8"
      >
        <h2 id={titleId} className="font-serif text-2xl mb-6">New folder</h2>

        <label className="block">
          <span className="tag block mb-2">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
            placeholder="Weeknight cinema"
            className="w-full bg-transparent border-b border-rule focus:border-accent outline-none py-2 text-lg"
          />
          {error ? <p className="mt-2 text-sm text-accent" role="alert">{error}</p> : null}
        </label>

        <fieldset className="mt-8">
          <legend className="tag block mb-3">Venues</legend>
          <div className="space-y-2 max-h-48 overflow-auto">
            {venues.length === 0 ? <p className="text-sm text-muted">No venues yet.</p> : null}
            {venues.map((v) => (
              <label key={v.id} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={venueIds.includes(v.id)}
                  onChange={() => setVenueIds((arr) => toggle(arr, v.id))}
                  className="accent-accent"
                />
                <span>{v.name}</span>
                <span className="text-muted">· {v.city}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-8">
          <legend className="tag block mb-3">Categories</legend>
          <div className="flex flex-wrap gap-3">
            {CATEGORIES.map((c) => {
              const active = categories.includes(c);
              return (
                <button
                  type="button"
                  key={c}
                  aria-pressed={active}
                  onClick={() => setCategories((arr) => toggle(arr, c))}
                  className={`tag bg-transparent border-0 cursor-pointer ${active ? 'text-accent' : 'text-muted hover:text-ink'}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </fieldset>

        {serverError ? (
          <p role="alert" className="mt-8 text-sm text-accent">
            Couldn&rsquo;t create folder: {serverError}
          </p>
        ) : null}

        <div className="mt-10 flex justify-end gap-6 text-sm">
          <button type="button" onClick={onCancel} className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="link-accent bg-transparent border-0 cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create folder'}
          </button>
        </div>
      </form>
    </div>
  );
}

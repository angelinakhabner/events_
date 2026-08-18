import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { categoryLabel } from '../lib/format';

/**
 * "Propose me similar venues in city X, like the ones in this folder, of type
 * Z" (GOI-86).
 *
 * Sits under a folder because the folder *is* the input: its venues are the
 * taste exemplars the suggestions are matched against. A city and an optional
 * type narrow it — both free text, since the ticket's example ("Type
 * Museums") is a phrase rather than a fixed list.
 *
 * Suggestions are proposals, not subscriptions. "Add" runs the ordinary
 * add-venue mutation, so each one is probed like any pasted URL — a venue the
 * model invented fails there, visibly, instead of silently joining the folder
 * and never producing an event.
 */
export function SuggestVenuesPanel({ folderId, folderName, onAdded }: {
  folderId: string;
  folderName: string;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState('');
  const [type, setType] = useState('');
  /** Names added in this session, so a row can show it landed without the
   *  whole list re-fetching and reshuffling under the cursor. */
  const [added, setAdded] = useState<string[]>([]);

  const suggest = trpc.my.venues.suggestSimilar.useMutation();
  const add = trpc.my.venues.add.useMutation({
    onSuccess: (_data, vars) => {
      setAdded((prev) => [...prev, vars.url]);
      onAdded();
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!city.trim()) return;
    setAdded([]);
    suggest.mutate({ listId: folderId, city: city.trim(), type: type.trim() || undefined });
  };

  const results = suggest.data?.suggestions ?? [];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-xs font-extrabold uppercase tracking-[0.5px] text-ink underline hover:text-accent cursor-pointer bg-transparent border-0 p-0"
      >
        + Propose similar venues elsewhere
      </button>
    );
  }

  return (
    <div className="mt-4 border-3 border-ink p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h4 className="label-caps m-0">Similar to &ldquo;{folderName}&rdquo;, elsewhere</h4>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-extrabold uppercase text-muted hover:text-accent cursor-pointer bg-transparent border-0 p-0"
        >
          Close
        </button>
      </div>

      <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block flex-1 min-w-[140px]">
          <span className="label-caps mb-2">City</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Berlin"
            className="field text-sm"
          />
        </label>
        <label className="block flex-1 min-w-[140px]">
          <span className="label-caps mb-2">Type (optional)</span>
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="Museums"
            className="field text-sm"
          />
        </label>
        <button type="submit" disabled={!city.trim() || suggest.isPending} className="btn-fill">
          {suggest.isPending ? 'Thinking…' : 'Propose'}
        </button>
      </form>

      {suggest.error ? (
        <p role="alert" className="mt-4 text-sm font-bold text-accent">{suggest.error.message}</p>
      ) : null}

      {suggest.isSuccess && results.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          Nothing came back for that city — try a broader type, or a bigger city.
        </p>
      ) : null}

      {results.length > 0 ? (
        <>
          <p className="mt-4 mb-0 text-xs text-muted">
            Based on {suggest.data?.basedOn} venue{suggest.data?.basedOn === 1 ? '' : 's'} in this folder.
            Adding one checks whether it can actually be scraped.
          </p>
          <ul className="mt-3 list-none m-0 p-0 border-t-2 border-ink">
            {results.map((s) => {
              const isAdded = added.includes(s.url);
              return (
                <li key={s.url} className="border-b-2 border-ink py-3 flex items-start gap-4">
                  <div className="flex-1">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-bold text-sm underline hover:text-accent"
                    >
                      {s.name}
                    </a>
                    <span className="text-muted text-xs"> · {s.city} · {categoryLabel(s.category)}</span>
                    <p className="mt-1 mb-0 text-xs text-muted">{s.why}</p>
                  </div>
                  <button
                    type="button"
                    disabled={isAdded || add.isPending}
                    onClick={() =>
                      add.mutate({
                        name: s.name,
                        url: s.url,
                        city: s.city,
                        country: s.country,
                        category: s.category,
                        listId: folderId,
                      })
                    }
                    className="btn-outline shrink-0 text-xs"
                  >
                    {isAdded ? 'Added' : 'Add'}
                  </button>
                </li>
              );
            })}
          </ul>
          {add.error ? (
            <p role="alert" className="mt-3 text-sm font-bold text-accent">
              Couldn&rsquo;t add it: {add.error.message}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

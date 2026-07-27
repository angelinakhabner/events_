import { useMemo, useState } from 'react';
import type { Category } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { AddVenueForm, CATEGORIES } from './AddVenueForm';
import { ErrorState, SkeletonList } from './states';

/**
 * /my → "My venues" (GOI-25): every venue you follow, segregated by folder,
 * each row carrying its own tags. Everything the tab needs to grow is here —
 * add a venue, add a tag, add a folder — and a venue can be moved between
 * folders from its row.
 *
 * A "folder" is a user venue list on the wire (`my.lists.*`); exactly one is
 * *active*, and only the active folder's venues keep getting scraped.
 */
export function MyVenuesSection() {
  const utils = trpc.useUtils();
  const venuesQuery = trpc.my.venues.listAll.useQuery();
  const listsQuery = trpc.my.lists.list.useQuery();
  const [adding, setAdding] = useState(false);

  const invalidate = () => {
    utils.my.venues.listAll.invalidate();
    utils.my.venues.list.invalidate();
    utils.my.lists.list.invalidate();
  };
  const add = trpc.my.venues.add.useMutation({
    onSuccess: () => { invalidate(); setAdding(false); },
  });

  const venueRows = venuesQuery.data;
  const folders = useMemo(() => listsQuery.data ?? [], [listsQuery.data]);

  /** One section per folder, in folder order, plus an "Unfiled" bucket for
   *  legacy subscriptions that never got a folder. */
  const grouped = useMemo(() => {
    const byFolder = new Map<string | null, NonNullable<typeof venueRows>>();
    for (const v of venueRows ?? []) {
      const key = folders.some((f) => f.id === v.listId) ? v.listId : null;
      const list = byFolder.get(key) ?? [];
      list.push(v);
      byFolder.set(key, list);
    }
    const sections = folders.map((f) => ({
      id: f.id as string | null,
      name: f.name,
      active: f.active,
      venues: byFolder.get(f.id) ?? [],
    }));
    const unfiled = byFolder.get(null);
    if (unfiled?.length) {
      sections.push({ id: null, name: 'Unfiled', active: false, venues: unfiled });
    }
    return sections;
  }, [venueRows, folders]);

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl tracking-tight">My venues</h2>
          <p className="mt-1 text-sm text-muted max-w-prose">
            Every venue you follow, filed into folders. Rename a venue, change its category
            or add your own tags — those changes are only visible to you.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="link-accent text-sm bg-transparent border-0 cursor-pointer"
        >
          {adding ? 'Cancel' : 'Add venue'}
        </button>
      </div>

      <FoldersBar />

      {adding ? (
        <AddVenueForm
          onSubmit={(input) => add.mutate(input)}
          submitting={add.isPending}
          error={add.error?.message ?? null}
        />
      ) : null}

      {venuesQuery.isLoading ? <SkeletonList rows={4} /> : null}
      {venuesQuery.error ? (
        <ErrorState message="Couldn't load your venues." onRetry={() => venuesQuery.refetch()} />
      ) : null}
      {venueRows && venueRows.length === 0 ? (
        <p className="text-sm text-muted">
          No venues yet — use &ldquo;Add venue&rdquo; to add one by URL.
        </p>
      ) : null}

      {grouped.map((folder) => (
        <div key={folder.id ?? 'unfiled'} className="mb-10">
          <h3 className="mb-2 flex items-baseline gap-3 text-xs uppercase tracking-widest text-muted">
            {folder.name}
            {folder.active ? <span className="text-accent normal-case tracking-normal">active</span> : null}
            <span className="normal-case tracking-normal">
              {folder.venues.length} venue{folder.venues.length === 1 ? '' : 's'}
            </span>
          </h3>
          {folder.venues.length === 0 ? (
            <p className="text-sm text-muted">Nothing filed here yet.</p>
          ) : (
            <ul className="divide-y divide-rule border-y border-rule list-none m-0 p-0">
              {folder.venues.map((v) => (
                <VenueRow key={v.id} venue={v} folders={folders} onChanged={invalidate} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

// ─── Folders ─────────────────────────────────────────────────────────────────

/**
 * Folder switcher. Every folder's venues are listed below regardless — this
 * bar is about which one is *active*, since only the active folder is kept
 * fresh by the scraper.
 */
function FoldersBar() {
  const utils = trpc.useUtils();
  const listsQuery = trpc.my.lists.list.useQuery();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const invalidate = () => {
    utils.my.lists.list.invalidate();
    utils.my.venues.list.invalidate();
    utils.my.venues.listAll.invalidate();
  };
  const setActive = trpc.my.lists.setActive.useMutation({ onSuccess: invalidate });
  const create = trpc.my.lists.create.useMutation({
    onSuccess: () => { invalidate(); setCreating(false); setNewName(''); },
  });
  const rename = trpc.my.lists.rename.useMutation({
    onSuccess: () => { invalidate(); setRenaming(false); },
  });
  const remove = trpc.my.lists.remove.useMutation({ onSuccess: invalidate });

  const folders = listsQuery.data ?? [];
  const active = folders.find((l) => l.active);
  const mutationError =
    setActive.error?.message ?? create.error?.message ?? rename.error?.message ?? remove.error?.message ?? null;

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center gap-2">
        {folders.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={l.active}
            onClick={() => { if (!l.active) setActive.mutate({ listId: l.id }); }}
            disabled={setActive.isPending}
            className={
              l.active
                ? 'border border-ink bg-ink text-paper px-3 py-1 text-sm cursor-default'
                : 'border border-rule bg-transparent text-muted hover:text-ink px-3 py-1 text-sm cursor-pointer disabled:opacity-50'
            }
          >
            {l.name} <span className="opacity-70">({l.venueCount})</span>
          </button>
        ))}
        {creating ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate({ name: newName.trim() });
            }}
          >
            <label className="sr-only" htmlFor="new-folder-name">Folder name</label>
            <input
              id="new-folder-name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Poznan"
              className="border border-rule bg-paper px-2 py-1 text-sm"
            />
            <button type="submit" disabled={create.isPending} className="link-accent text-sm bg-transparent border-0 cursor-pointer disabled:opacity-50">
              Create
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName(''); }}
              className="text-sm text-muted hover:text-ink bg-transparent border-0 cursor-pointer"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="link-accent text-sm bg-transparent border-0 cursor-pointer">
            + New folder
          </button>
        )}
      </div>

      {active ? (
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted">
          {renaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (renameValue.trim()) rename.mutate({ listId: active.id, name: renameValue.trim() });
              }}
            >
              <label className="sr-only" htmlFor="rename-folder">New folder name</label>
              <input
                id="rename-folder"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="border border-rule bg-paper px-2 py-1 text-sm"
              />
              <button type="submit" disabled={rename.isPending} className="link-accent bg-transparent border-0 cursor-pointer disabled:opacity-50">
                Save
              </button>
              <button type="button" onClick={() => setRenaming(false)} className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer">
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => { setRenameValue(active.name); setRenaming(true); }}
              className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0"
            >
              Rename folder
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete "${active.name}" and its ${active.venueCount} venue subscription(s)?`)) {
                remove.mutate({ listId: active.id });
              }
            }}
            className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0"
          >
            Delete folder
          </button>
        </div>
      ) : null}

      {mutationError ? <p className="mt-2 text-sm text-red-700">{mutationError}</p> : null}
      <p className="mt-3 text-xs text-muted max-w-prose">
        Only the active folder is kept fresh — venues in your other folders aren&rsquo;t
        scraped until you make their folder active.
      </p>
    </div>
  );
}

// ─── Venue row ───────────────────────────────────────────────────────────────

interface VenueRowVenue {
  id: string;
  name: string;
  url: string;
  category: Category;
  windowDays: number | null;
  customized: boolean;
  listId: string | null;
  tags: string[];
}

interface FolderOption {
  id: string;
  name: string;
}

function VenueRow({
  venue,
  folders,
  onChanged,
}: {
  venue: VenueRowVenue;
  folders: FolderOption[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(venue.name);
  const [category, setCategory] = useState<Category>(venue.category);
  const [windowDays, setWindowDays] = useState<string>(venue.windowDays?.toString() ?? '');

  const update = trpc.my.venues.update.useMutation({ onSuccess: onChanged });
  const remove = trpc.my.venues.remove.useMutation({ onSuccess: onChanged });

  const save = () => {
    const patch: { name?: string; category?: Category; windowDays?: number | null } = {};
    if (name.trim() && name.trim() !== venue.name) patch.name = name.trim();
    if (category !== venue.category) patch.category = category;
    const w = windowDays === '' ? null : Number(windowDays);
    if (w !== venue.windowDays && (w === null || (Number.isInteger(w) && w >= 1 && w <= 90))) {
      patch.windowDays = w;
    }
    if (Object.keys(patch).length) update.mutate({ venueId: venue.id, ...patch });
    setEditing(false);
  };

  if (!editing) {
    return (
      <li className="py-3">
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <span className="text-ink">{venue.name}</span>
            {venue.customized ? <span className="ml-2 text-xs text-muted">(edited)</span> : null}
            <span className="ml-3 text-xs text-muted">
              {venue.windowDays ? `${venue.windowDays}d window` : 'default window'}
            </span>
          </div>
          <div className="flex shrink-0 items-baseline gap-4 text-sm">
            {folders.length > 1 ? (
              <>
                <label className="sr-only" htmlFor={`folder-${venue.id}`}>Folder for {venue.name}</label>
                <select
                  id={`folder-${venue.id}`}
                  value={venue.listId ?? ''}
                  onChange={(e) => update.mutate({ venueId: venue.id, listId: e.target.value })}
                  disabled={update.isPending}
                  className="border border-rule bg-paper px-2 py-1 text-xs"
                >
                  {venue.listId === null ? <option value="">Unfiled</option> : null}
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </>
            ) : null}
            <button type="button" onClick={() => setEditing(true)} className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer">
              Edit
            </button>
            <button
              type="button"
              onClick={() => remove.mutate({ venueId: venue.id })}
              className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer"
            >
              Remove
            </button>
          </div>
        </div>
        <VenueTags
          venue={venue}
          onSave={(tags) => update.mutate({ venueId: venue.id, tags })}
          saving={update.isPending}
        />
        {update.error ? <p className="mt-1 text-sm text-red-700">{update.error.message}</p> : null}
      </li>
    );
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor={`name-${venue.id}`}>Name</label>
        <input
          id={`name-${venue.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 min-w-[12rem] border border-rule bg-paper px-2 py-1 text-sm"
        />
        <label className="sr-only" htmlFor={`category-${venue.id}`}>Category</label>
        <select
          id={`category-${venue.id}`}
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="border border-rule bg-paper px-2 py-1 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="text-xs text-muted" htmlFor={`window-${venue.id}`}>
          window (days)
        </label>
        <input
          id={`window-${venue.id}`}
          type="number"
          min={1}
          max={90}
          value={windowDays}
          onChange={(e) => setWindowDays(e.target.value)}
          placeholder="default"
          className="w-20 border border-rule bg-paper px-2 py-1 text-sm"
        />
        <button type="button" onClick={save} className="link-accent text-sm bg-transparent border-0 cursor-pointer">
          Save
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setName(venue.name); setCategory(venue.category); }}
          className="text-sm text-muted hover:text-ink bg-transparent border-0 cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </li>
  );
}

/** Tag chips plus an inline "add tag" field. The mutation replaces the whole
 *  set, so add/remove both send the new list. */
function VenueTags({
  venue,
  onSave,
  saving,
}: {
  venue: VenueRowVenue;
  onSave: (tags: string[]) => void;
  saving: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');

  const addTag = () => {
    const tag = value.trim();
    if (!tag) return;
    if (!venue.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      onSave([...venue.tags, tag]);
    }
    setValue('');
    setAdding(false);
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {venue.tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 border border-rule px-2 py-0.5 text-xs text-muted">
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag} from ${venue.name}`}
            onClick={() => onSave(venue.tags.filter((t) => t !== tag))}
            disabled={saving}
            className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0 leading-none disabled:opacity-50"
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); addTag(); }}
        >
          <label className="sr-only" htmlFor={`tag-${venue.id}`}>New tag for {venue.name}</label>
          <input
            id={`tag-${venue.id}`}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. date night"
            className="border border-rule bg-paper px-2 py-0.5 text-xs"
          />
          <button type="submit" disabled={saving} className="link-accent text-xs bg-transparent border-0 cursor-pointer disabled:opacity-50">
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setValue(''); }}
            className="text-xs text-muted hover:text-ink bg-transparent border-0 cursor-pointer"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          aria-label={`Add tag to ${venue.name}`}
          onClick={() => setAdding(true)}
          className="link-accent text-xs bg-transparent border-0 cursor-pointer"
        >
          + Add tag
        </button>
      )}
    </div>
  );
}

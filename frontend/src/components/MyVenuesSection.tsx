import { useMemo, useState } from 'react';
import type { Category } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { categoryLabel } from '../lib/format';
import type { VenueSchedule } from '@afisz/shared';
import { AddVenueForm, CATEGORIES } from './AddVenueForm';
import { CategorySwatch } from './CategorySwatch';
import { PanelHeading } from './PanelHeading';
import { ErrorState, SkeletonList } from './states';
import { VenueScheduleNote } from './VenueScheduleNote';

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
  const activityQuery = trpc.my.venues.activity.useQuery();
  const [adding, setAdding] = useState(false);

  // Keyed lookup so a row costs nothing; an absent entry simply renders no
  // note, which is also what happens while the query is still in flight.
  const scheduleByVenue = useMemo(
    () => new Map((activityQuery.data ?? []).map((a) => [a.venueId, a as VenueSchedule])),
    [activityQuery.data],
  );

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
      <PanelHeading
        title="My venues"
        blurb="Every venue you follow, filed into folders. Rename a venue, change its category or add your own tags — those changes are only visible to you."
        rule={false}
        action={
          <button type="button" onClick={() => setAdding((v) => !v)} className="act act-on">
            {adding ? 'Cancel' : 'Add venue'}
          </button>
        }
      />

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
          <h3 className="mb-0 flex items-baseline gap-3 tag pb-2">
            {folder.name}
            {folder.active ? <span className="text-accent">active</span> : null}
            <span>
              {folder.venues.length} venue{folder.venues.length === 1 ? '' : 's'}
            </span>
          </h3>
          {folder.venues.length === 0 ? (
            <p className="text-sm text-muted border-t-3 border-ink pt-4">Nothing filed here yet.</p>
          ) : (
            <ul className="border-t-3 border-ink list-none m-0 p-0">
              {folder.venues.map((v) => (
                <VenueRow
                  key={v.id}
                  venue={v}
                  folders={folders}
                  schedule={scheduleByVenue.get(v.id)}
                  onChanged={invalidate}
                />
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
            className={`border-2 border-ink px-3.5 py-2 text-xs font-extrabold uppercase tracking-[0.5px] ${
              l.active
                ? 'bg-ink text-white cursor-default'
                : 'bg-transparent text-ink hover:text-accent hover:border-accent cursor-pointer disabled:opacity-50'
            }`}
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
              className="field-sm"
            />
            <button type="submit" disabled={create.isPending} className="act act-on">
              Create
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName(''); }}
              className="act"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="act act-on">
            + New folder
          </button>
        )}
      </div>

      {active ? (
        <div className="mt-3 flex flex-wrap items-center gap-5">
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
                className="field-sm"
              />
              <button type="submit" disabled={rename.isPending} className="act act-sm act-on">
                Save
              </button>
              <button type="button" onClick={() => setRenaming(false)} className="act act-sm">
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => { setRenameValue(active.name); setRenaming(true); }}
              className="act act-sm"
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
            className="act act-sm"
          >
            Delete folder
          </button>
        </div>
      ) : null}

      {mutationError ? <p className="mt-2 text-sm text-accent">{mutationError}</p> : null}
      <p className="mt-3.5 text-xs text-muted max-w-[520px]">
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
  schedule,
  onChanged,
}: {
  venue: VenueRowVenue;
  folders: FolderOption[];
  schedule: VenueSchedule | undefined;
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
      <li className="flex items-start gap-4 md:gap-5 py-5 md:py-6 rule-soft">
        <CategorySwatch category={venue.category} size={20} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h4 className="m-0 text-lg md:text-[22px] font-bold text-ink">
                {venue.name}
                {venue.customized ? (
                  <span className="ml-2 text-[11px] font-medium text-faint">(edited)</span>
                ) : null}
              </h4>
              {/* The design's "{TAG} · {N} UPCOMING" line — the category the
                  venue is filed under, and how much it actually has on. */}
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 tag text-[12px]">
                <span>{categoryLabel(venue.category)}</span>
                <span aria-hidden>·</span>
                <span>{schedule?.upcomingCount ?? 0} upcoming</span>
                <span aria-hidden>·</span>
                <span>{venue.windowDays ? `${venue.windowDays}d window` : 'default window'}</span>
                <VenueScheduleNote schedule={schedule} />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              {folders.length > 1 ? (
                <>
                  <label className="sr-only" htmlFor={`folder-${venue.id}`}>Folder for {venue.name}</label>
                  <select
                    id={`folder-${venue.id}`}
                    value={venue.listId ?? ''}
                    onChange={(e) => update.mutate({ venueId: venue.id, listId: e.target.value })}
                    disabled={update.isPending}
                    className="border-2 border-ink bg-transparent px-2 py-1 text-[11px] font-bold uppercase tracking-[0.5px] cursor-pointer"
                  >
                    {venue.listId === null ? <option value="">Unfiled</option> : null}
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </>
              ) : null}
              <button type="button" onClick={() => setEditing(true)} className="act act-sm">
                Edit
              </button>
              <button
                type="button"
                onClick={() => remove.mutate({ venueId: venue.id })}
                className="act act-sm"
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
          {update.error ? <p className="mt-1.5 text-sm text-accent">{update.error.message}</p> : null}
        </div>
      </li>
    );
  }

  return (
    <li className="py-5 rule-soft">
      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor={`name-${venue.id}`}>Name</label>
        <input
          id={`name-${venue.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field-sm flex-1 min-w-[12rem]"
        />
        <label className="sr-only" htmlFor={`category-${venue.id}`}>Category</label>
        <select
          id={`category-${venue.id}`}
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="field-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="tag" htmlFor={`window-${venue.id}`}>
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
          className="field-sm w-20"
        />
        <button type="button" onClick={save} className="act act-on">
          Save
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setName(venue.name); setCategory(venue.category); }}
          className="act"
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
        <span key={tag} className="inline-flex items-center gap-1.5 border-2 border-ink px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.5px] text-ink">
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag} from ${venue.name}`}
            onClick={() => onSave(venue.tags.filter((t) => t !== tag))}
            disabled={saving}
            className="act act-sm leading-none"
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
            className="field-sm py-0.5 text-[11px]"
          />
          <button type="submit" disabled={saving} className="act act-sm act-on">
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setValue(''); }}
            className="act act-sm"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          aria-label={`Add tag to ${venue.name}`}
          onClick={() => setAdding(true)}
          className="act act-sm act-on"
        >
          + Add tag
        </button>
      )}
    </div>
  );
}

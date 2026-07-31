import { useState } from 'react';
import type { Folder, Venue } from '@afisz/shared';
import { filterSummary } from '../lib/format';

interface Props {
  folder: Folder;
  venues: Venue[];
  expanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  children?: React.ReactNode;
}

export function FolderCard({ folder, venues, expanded, onToggle, onRename, onDelete, children }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const venuesInFolder = venues.filter((v) => folder.venueIds.includes(v.id));

  const submit = () => {
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== folder.name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <article className="py-6 rule-soft">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          {editing ? (
            <input
              autoFocus
              aria-label="Folder name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={submit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') { setDraft(folder.name); setEditing(false); }
              }}
              className="text-2xl font-bold bg-transparent border-b-2 border-accent outline-none w-full"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-2xl font-bold text-ink bg-transparent border-0 p-0 cursor-text text-left"
              aria-label={`Rename folder ${folder.name}`}
            >
              {folder.name}
            </button>
          )}
          <p className="mt-1.5 tag">
            {filterSummary(folder.filters, venuesInFolder.length)}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button type="button" onClick={onToggle} className="act act-on">
            {expanded ? 'Hide events' : 'Show events'}
          </button>
          {confirmingDelete ? (
            <span className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => { setConfirmingDelete(false); onDelete(); }}
                className="act act-on"
              >
                Confirm delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="act"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="act"
              aria-label={`Delete folder ${folder.name}`}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      {expanded ? <div className="mt-6">{children}</div> : null}
    </article>
  );
}

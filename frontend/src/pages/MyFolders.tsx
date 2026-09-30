import { useMemo, useState } from 'react';
import { trpc } from '../lib/trpc';
import { FolderCard } from '../components/FolderCard';
import { NewFolderModal, type NewFolderPayload } from '../components/NewFolderModal';
import { EventList } from '../components/EventList';
import { PanelHeading } from '../components/PanelHeading';
import { EmptyState, ErrorState, SkeletonList } from '../components/states';

export function MyFoldersPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const utils = trpc.useUtils();
  const foldersQuery = trpc.folders.listMine.useQuery();
  const venuesQuery = trpc.venues.list.useQuery();

  const venues = useMemo(() => venuesQuery.data ?? [], [venuesQuery.data]);
  const venueMap = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues]);

  const create = trpc.folders.create.useMutation({
    onSuccess: () => { utils.folders.listMine.invalidate(); setModalOpen(false); },
  });
  const update = trpc.folders.update.useMutation({
    onSuccess: () => utils.folders.listMine.invalidate(),
  });
  const remove = trpc.folders.delete.useMutation({
    onSuccess: () => utils.folders.listMine.invalidate(),
  });

  const submit = (payload: NewFolderPayload) => create.mutate(payload);

  return (
    <section>
      <PanelHeading
        title="Moje foldery"
        blurb="Wybrane zestawy miejsc z zapamiętanymi filtrami."
        action={
          <button type="button" onClick={() => setModalOpen(true)} className="act act-on">
            Nowy folder
          </button>
        }
      />

      {foldersQuery.isLoading ? <SkeletonList rows={3} /> : null}
      {foldersQuery.error ? (
        <ErrorState message="Nie udało się wczytać folderów." onRetry={() => foldersQuery.refetch()} />
      ) : null}

      {foldersQuery.data && foldersQuery.data.length === 0 ? (
        <EmptyState
          title="Nie masz jeszcze folderów"
          hint="Foldery grupują miejsca z zapamiętanymi filtrami."
          action={{ label: 'Utwórz pierwszy folder', onClick: () => setModalOpen(true) }}
        />
      ) : null}

      {foldersQuery.data?.map((folder) => (
        <FolderCard
          key={folder.id}
          folder={folder}
          venues={venues}
          expanded={!!expanded[folder.id]}
          onToggle={() => setExpanded((s) => ({ ...s, [folder.id]: !s[folder.id] }))}
          onRename={(name) => update.mutate({ id: folder.id, name })}
          onDelete={() => remove.mutate({ id: folder.id })}
        >
          <FolderEvents folderId={folder.id} venueMap={venueMap} />
        </FolderCard>
      ))}

      {modalOpen ? (
        <NewFolderModal
          venues={venues}
          onCancel={() => { setModalOpen(false); create.reset(); }}
          onSubmit={submit}
          submitting={create.isPending}
          serverError={create.error?.message ?? null}
        />
      ) : null}
    </section>
  );
}

function FolderEvents({ folderId, venueMap }: { folderId: string; venueMap: Map<string, import('@afisz/shared').Venue> }) {
  const q = trpc.folders.getEvents.useQuery({ folderId });
  if (q.isLoading) return <SkeletonList rows={2} />;
  if (q.error) return <p className="text-sm text-muted">Nie udało się wczytać wydarzeń.</p>;
  if (!q.data || q.data.length === 0) return <p className="text-sm text-muted">Żadne wydarzenie nie pasuje do tego folderu.</p>;
  return <EventList events={q.data} venues={venueMap} />;
}

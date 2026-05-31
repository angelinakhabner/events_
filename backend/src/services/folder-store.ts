import type { Folder, EventFilters } from '@goin/shared';

export interface CreateFolderInput {
  name: string;
  venueIds: string[];
  filters: EventFilters;
}

export interface UpdateFolderInput {
  id: string;
  name?: string;
  venueIds?: string[];
  filters?: EventFilters;
}

// In-memory folder store, scoped to a single anonymous user for the MVP.
// Swap for a Drizzle-backed implementation once auth + DATABASE_URL land.
export class FolderStore {
  private folders = new Map<string, Folder>();
  private seq = 0;

  list(): Folder[] {
    return [...this.folders.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): Folder | undefined {
    return this.folders.get(id);
  }

  create(input: CreateFolderInput): Folder {
    this.seq += 1;
    const folder: Folder = {
      id: `folder-${this.seq}`,
      userId: null,
      name: input.name,
      venueIds: [...input.venueIds],
      filters: { ...input.filters },
      createdAt: new Date().toISOString(),
    };
    this.folders.set(folder.id, folder);
    return folder;
  }

  update(input: UpdateFolderInput): Folder {
    const current = this.folders.get(input.id);
    if (!current) throw new Error(`Folder ${input.id} not found`);
    const next: Folder = {
      ...current,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.venueIds !== undefined ? { venueIds: [...input.venueIds] } : {}),
      ...(input.filters !== undefined ? { filters: { ...input.filters } } : {}),
    };
    this.folders.set(next.id, next);
    return next;
  }

  delete(id: string): boolean {
    return this.folders.delete(id);
  }
}

export const defaultFolderStore = new FolderStore();

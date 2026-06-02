import { and, eq } from 'drizzle-orm';
import type { Folder, EventFilters } from '@goin/shared';
import { folders as foldersTable } from '../db/schema.js';
import { getDb } from '../db/index.js';

export interface CreateFolderInput {
  deviceId: string;
  name: string;
  venueIds: string[];
  filters: EventFilters;
}

export interface UpdateFolderInput {
  deviceId: string;
  id: string;
  name?: string;
  venueIds?: string[];
  filters?: EventFilters;
}

export interface FolderStore {
  list(deviceId: string): Promise<Folder[]>;
  get(deviceId: string, id: string): Promise<Folder | undefined>;
  create(input: CreateFolderInput): Promise<Folder>;
  update(input: UpdateFolderInput): Promise<Folder>;
  delete(deviceId: string, id: string): Promise<boolean>;
}

// In-memory, partitioned by deviceId. Kept as a default for unit tests and
// when DATABASE_URL is not configured. Same async signature as the DB store
// so call sites don't care which one they're talking to.
export class InMemoryFolderStore implements FolderStore {
  private folders = new Map<string, Folder>();
  private seq = 0;

  async list(deviceId: string): Promise<Folder[]> {
    return [...this.folders.values()]
      .filter((f) => f.userId === deviceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(deviceId: string, id: string): Promise<Folder | undefined> {
    const f = this.folders.get(id);
    return f && f.userId === deviceId ? f : undefined;
  }

  async create(input: CreateFolderInput): Promise<Folder> {
    this.seq += 1;
    const folder: Folder = {
      id: `folder-${this.seq}`,
      userId: input.deviceId,
      name: input.name,
      venueIds: [...input.venueIds],
      filters: { ...input.filters },
      createdAt: new Date().toISOString(),
    };
    this.folders.set(folder.id, folder);
    return folder;
  }

  async update(input: UpdateFolderInput): Promise<Folder> {
    const current = this.folders.get(input.id);
    if (!current) throw new Error(`Folder ${input.id} not found`);
    if (current.userId !== input.deviceId) throw new Error('Forbidden');
    const next: Folder = {
      ...current,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.venueIds !== undefined ? { venueIds: [...input.venueIds] } : {}),
      ...(input.filters !== undefined ? { filters: { ...input.filters } } : {}),
    };
    this.folders.set(next.id, next);
    return next;
  }

  async delete(deviceId: string, id: string): Promise<boolean> {
    const current = this.folders.get(id);
    if (!current) return false;
    if (current.userId !== deviceId) throw new Error('Forbidden');
    return this.folders.delete(id);
  }
}

export class DbFolderStore implements FolderStore {
  async list(deviceId: string): Promise<Folder[]> {
    const rows = await getDb()
      .select()
      .from(foldersTable)
      .where(eq(foldersTable.deviceId, deviceId))
      .orderBy(foldersTable.createdAt);
    return rows.map(toFolder);
  }

  async get(deviceId: string, id: string): Promise<Folder | undefined> {
    const [row] = await getDb()
      .select()
      .from(foldersTable)
      .where(and(eq(foldersTable.id, id), eq(foldersTable.deviceId, deviceId)));
    return row ? toFolder(row) : undefined;
  }

  async create(input: CreateFolderInput): Promise<Folder> {
    const [row] = await getDb()
      .insert(foldersTable)
      .values({
        deviceId: input.deviceId,
        name: input.name,
        venueIds: input.venueIds,
        filters: input.filters as Record<string, unknown>,
      })
      .returning();
    return toFolder(row!);
  }

  async update(input: UpdateFolderInput): Promise<Folder> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.venueIds !== undefined) patch.venueIds = input.venueIds;
    if (input.filters !== undefined) patch.filters = input.filters;

    const [row] = await getDb()
      .update(foldersTable)
      .set(patch)
      .where(and(eq(foldersTable.id, input.id), eq(foldersTable.deviceId, input.deviceId)))
      .returning();
    if (!row) throw new Error('Folder not found or forbidden');
    return toFolder(row);
  }

  async delete(deviceId: string, id: string): Promise<boolean> {
    const db = getDb();
    const [existing] = await db
      .select({ deviceId: foldersTable.deviceId })
      .from(foldersTable)
      .where(eq(foldersTable.id, id));
    if (!existing) return false;
    if (existing.deviceId !== deviceId) throw new Error('Forbidden');
    const rows = await db
      .delete(foldersTable)
      .where(eq(foldersTable.id, id))
      .returning({ id: foldersTable.id });
    return rows.length > 0;
  }
}

type Row = typeof foldersTable.$inferSelect;

function toFolder(row: Row): Folder {
  return {
    id: row.id,
    userId: row.deviceId,
    name: row.name,
    venueIds: row.venueIds,
    filters: row.filters as Folder['filters'],
    createdAt: row.createdAt.toISOString(),
  };
}

export const defaultFolderStore: FolderStore = process.env.DATABASE_URL
  ? new DbFolderStore()
  : new InMemoryFolderStore();

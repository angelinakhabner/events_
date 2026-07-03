import { and, desc, eq } from 'drizzle-orm';
import type { Event } from '@goin/shared';
import { getDb, schema } from '../db/index.js';
import { defaultEventStore } from './event-store.js';

// "Want to go" bookmarks: a logged-in user's saved events.

export interface WantToGoStore {
  /** The user's saved events, soonest first, venue summary inlined. */
  list(userId: string): Promise<Event[]>;
  /** Ids only — cheap for toggling hearts on event lists. */
  listIds(userId: string): Promise<string[]>;
  add(userId: string, eventId: string): Promise<void>;
  remove(userId: string, eventId: string): Promise<boolean>;
}

export class DbWantToGoStore implements WantToGoStore {
  async list(userId: string): Promise<Event[]> {
    const rows = await getDb()
      .select({ eventId: schema.wantToGo.eventId })
      .from(schema.wantToGo)
      .where(eq(schema.wantToGo.userId, userId))
      .orderBy(desc(schema.wantToGo.createdAt));
    if (rows.length === 0) return [];
    const events = await defaultEventStore.listByIds(rows.map((r) => r.eventId));
    return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  async listIds(userId: string): Promise<string[]> {
    const rows = await getDb()
      .select({ eventId: schema.wantToGo.eventId })
      .from(schema.wantToGo)
      .where(eq(schema.wantToGo.userId, userId));
    return rows.map((r) => r.eventId);
  }

  async add(userId: string, eventId: string): Promise<void> {
    await getDb().insert(schema.wantToGo).values({ userId, eventId }).onConflictDoNothing();
  }

  async remove(userId: string, eventId: string): Promise<boolean> {
    const rows = await getDb()
      .delete(schema.wantToGo)
      .where(and(eq(schema.wantToGo.userId, userId), eq(schema.wantToGo.eventId, eventId)))
      .returning({ eventId: schema.wantToGo.eventId });
    return rows.length > 0;
  }
}

// In-memory variant for tests / no DATABASE_URL. Stores ids only; list()
// returns [] because there is no event source to join against.
export class InMemoryWantToGoStore implements WantToGoStore {
  private byUser = new Map<string, Set<string>>();

  private setFor(userId: string): Set<string> {
    let s = this.byUser.get(userId);
    if (!s) this.byUser.set(userId, (s = new Set()));
    return s;
  }

  async list(): Promise<Event[]> {
    return [];
  }

  async listIds(userId: string): Promise<string[]> {
    return [...this.setFor(userId)];
  }

  async add(userId: string, eventId: string): Promise<void> {
    this.setFor(userId).add(eventId);
  }

  async remove(userId: string, eventId: string): Promise<boolean> {
    return this.setFor(userId).delete(eventId);
  }
}

export const defaultWantToGoStore: WantToGoStore = process.env.DATABASE_URL
  ? new DbWantToGoStore()
  : new InMemoryWantToGoStore();

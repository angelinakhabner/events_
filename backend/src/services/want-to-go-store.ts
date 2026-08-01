import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Event, WantToGoEntry } from '@afisz/shared';
import { getDb, schema } from '../db/index.js';
import { defaultEventStore } from './event-store.js';

// "Want to go" bookmarks: a logged-in user's saved events.
//
// An entry is never silently dropped once the date passes — the user either
// removes it or marks it seen (GOI-26), which files it under "Seen" and keeps
// it as a record of where they've been.

export interface WantToGoStore {
  /** The user's saved events, soonest first, venue summary inlined. */
  list(userId: string): Promise<Event[]>;
  /** Saved events with their seen state — what the /my list renders. */
  listEntries(userId: string): Promise<WantToGoEntry[]>;
  /** Ids only — cheap for toggling hearts on event lists. */
  listIds(userId: string): Promise<string[]>;
  add(userId: string, eventId: string): Promise<void>;
  /** Mark an entry seen (`seen: false` puts it back on the want list). */
  setSeen(userId: string, eventId: string, seen: boolean): Promise<boolean>;
  remove(userId: string, eventId: string): Promise<boolean>;

  // ─── Sharing (GOI-47) ──────────────────────────────────────────────────────

  /** The user's current share token, or null when the list isn't shared. */
  shareToken(userId: string): Promise<string | null>;
  /** Start sharing, or return the token already in use. */
  share(userId: string): Promise<string>;
  /** Stop sharing. The token is discarded, so the link it was in stops
   *  resolving for good — sharing again mints a new one. */
  unshare(userId: string): Promise<boolean>;
  /** Whose list a shared link points at, or null if it was revoked. */
  ownerOfShareToken(token: string): Promise<string | null>;
}

/** Share tokens live in URLs people paste into chats, so: unguessable, and
 *  base64url so nothing needs escaping. 32 bytes matches session tokens. */
function newShareToken(): string {
  return randomBytes(32).toString('base64url');
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

  async listEntries(userId: string): Promise<WantToGoEntry[]> {
    const rows = await getDb()
      .select({
        eventId: schema.wantToGo.eventId,
        seenAt: schema.wantToGo.seenAt,
        createdAt: schema.wantToGo.createdAt,
      })
      .from(schema.wantToGo)
      .where(eq(schema.wantToGo.userId, userId));
    if (rows.length === 0) return [];
    const events = await defaultEventStore.listByIds(rows.map((r) => r.eventId));
    const byId = new Map(events.map((e) => [e.id, e]));
    return rows
      .flatMap((r) => {
        const event = byId.get(r.eventId);
        if (!event) return [];
        return [{
          event,
          seenAt: r.seenAt ? r.seenAt.toISOString() : null,
          savedAt: r.createdAt.toISOString(),
        }];
      })
      .sort((a, b) => a.event.startsAt.localeCompare(b.event.startsAt));
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

  async setSeen(userId: string, eventId: string, seen: boolean): Promise<boolean> {
    const rows = await getDb()
      .update(schema.wantToGo)
      .set({ seenAt: seen ? new Date() : null })
      .where(and(eq(schema.wantToGo.userId, userId), eq(schema.wantToGo.eventId, eventId)))
      .returning({ eventId: schema.wantToGo.eventId });
    return rows.length > 0;
  }

  async remove(userId: string, eventId: string): Promise<boolean> {
    const rows = await getDb()
      .delete(schema.wantToGo)
      .where(and(eq(schema.wantToGo.userId, userId), eq(schema.wantToGo.eventId, eventId)))
      .returning({ eventId: schema.wantToGo.eventId });
    return rows.length > 0;
  }

  async shareToken(userId: string): Promise<string | null> {
    const [row] = await getDb()
      .select({ token: schema.wantToGoShares.token })
      .from(schema.wantToGoShares)
      .where(eq(schema.wantToGoShares.userId, userId));
    return row?.token ?? null;
  }

  async share(userId: string): Promise<string> {
    // Sharing an already-shared list hands back the same link rather than
    // rotating it, so pressing the button twice doesn't break the URL a
    // friend already has.
    const [row] = await getDb()
      .insert(schema.wantToGoShares)
      .values({ userId, token: newShareToken() })
      .onConflictDoNothing()
      .returning({ token: schema.wantToGoShares.token });
    if (row) return row.token;
    const existing = await this.shareToken(userId);
    if (existing) return existing;
    // Lost the insert race and the winner vanished before we looked: retry
    // once rather than returning a token that resolves to nothing.
    const [retry] = await getDb()
      .insert(schema.wantToGoShares)
      .values({ userId, token: newShareToken() })
      .returning({ token: schema.wantToGoShares.token });
    return retry!.token;
  }

  async unshare(userId: string): Promise<boolean> {
    const rows = await getDb()
      .delete(schema.wantToGoShares)
      .where(eq(schema.wantToGoShares.userId, userId))
      .returning({ userId: schema.wantToGoShares.userId });
    return rows.length > 0;
  }

  async ownerOfShareToken(token: string): Promise<string | null> {
    const [row] = await getDb()
      .select({ userId: schema.wantToGoShares.userId })
      .from(schema.wantToGoShares)
      .where(eq(schema.wantToGoShares.token, token));
    return row?.userId ?? null;
  }
}

// In-memory variant for tests / no DATABASE_URL. Stores ids + seen state only;
// list()/listEntries() return [] because there is no event source to join
// against.
export class InMemoryWantToGoStore implements WantToGoStore {
  private byUser = new Map<string, Map<string, { seenAt: string | null; savedAt: string }>>();

  private mapFor(userId: string): Map<string, { seenAt: string | null; savedAt: string }> {
    let m = this.byUser.get(userId);
    if (!m) this.byUser.set(userId, (m = new Map()));
    return m;
  }

  async list(): Promise<Event[]> {
    return [];
  }

  async listEntries(): Promise<WantToGoEntry[]> {
    return [];
  }

  async listIds(userId: string): Promise<string[]> {
    return [...this.mapFor(userId).keys()];
  }

  async add(userId: string, eventId: string): Promise<void> {
    const m = this.mapFor(userId);
    if (!m.has(eventId)) m.set(eventId, { seenAt: null, savedAt: new Date().toISOString() });
  }

  async setSeen(userId: string, eventId: string, seen: boolean): Promise<boolean> {
    const entry = this.mapFor(userId).get(eventId);
    if (!entry) return false;
    entry.seenAt = seen ? new Date().toISOString() : null;
    return true;
  }

  async remove(userId: string, eventId: string): Promise<boolean> {
    return this.mapFor(userId).delete(eventId);
  }

  private shares = new Map<string, string>();

  async shareToken(userId: string): Promise<string | null> {
    return this.shares.get(userId) ?? null;
  }

  async share(userId: string): Promise<string> {
    const existing = this.shares.get(userId);
    if (existing) return existing;
    const token = newShareToken();
    this.shares.set(userId, token);
    return token;
  }

  async unshare(userId: string): Promise<boolean> {
    return this.shares.delete(userId);
  }

  async ownerOfShareToken(token: string): Promise<string | null> {
    for (const [userId, t] of this.shares) if (t === token) return userId;
    return null;
  }
}

export const defaultWantToGoStore: WantToGoStore = process.env.DATABASE_URL
  ? new DbWantToGoStore()
  : new InMemoryWantToGoStore();

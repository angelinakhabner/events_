import { and, eq, max, sql } from 'drizzle-orm';
import type { Venue, Category } from '@goin/shared';
import { getDb, schema } from '../db/index.js';
import { DEFAULT_VENUES } from '../data/default-venues.js';

// Per-user venue subscriptions over the global venues table.
//
// The venue row is shared — venues.url is unique, so when 1000 users add
// Kinoteka they all point at one row and the scraper visits it once. What is
// personal lives on the subscription: name/category overrides (what *this*
// user sees) and windowDays (how far ahead they want events). The venue's
// effective scrape horizon is the max over its subscribers, so one user's
// wider window benefits everyone at no extra scrape.

/** A venue as one user sees it: overrides applied, plus their scrape prefs. */
export interface UserVenue extends Venue {
  /** Personal scrape horizon (days ahead); null = category default. */
  windowDays: number | null;
  /** True when name/category shown differ from the shared venue row. */
  customized: boolean;
}

export interface AddCustomVenueInput {
  name: string;
  url: string;
  city: string;
  country: string;
  category: Category;
  language?: string;
  timezone?: string;
  windowDays?: number | null;
}

export interface UpdateUserVenueInput {
  /** New personal display name; null clears the override. */
  name?: string | null;
  /** New personal category; null clears the override. */
  category?: Category | null;
  windowDays?: number | null;
}

export interface UserVenueStore {
  /** The user's venues, overrides applied. */
  list(userId: string): Promise<UserVenue[]>;
  /** First-login seeding: subscribe the user to every default venue so /my
   *  starts populated. No-op when the user already has subscriptions. */
  ensureSeeded(userId: string): Promise<void>;
  /** Add (or re-use, by URL) a venue and subscribe the user to it. */
  addCustom(userId: string, input: AddCustomVenueInput): Promise<UserVenue>;
  /** Edit personal overrides / scrape prefs for one subscription. */
  update(userId: string, venueId: string, patch: UpdateUserVenueInput): Promise<UserVenue>;
  /** Unsubscribe. The shared venue row (and other users) are untouched. */
  remove(userId: string, venueId: string): Promise<boolean>;
  /** Max windowDays over a venue's subscribers, or null when none set one. */
  maxWindowDays(venueId: string): Promise<number | null>;
}

export function normalizeVenueUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return u.toString();
  } catch {
    return url.trim();
  }
}

// ─── DB store ────────────────────────────────────────────────────────────────

type VenueRow = typeof schema.venues.$inferSelect;
type SubRow = typeof schema.userVenues.$inferSelect;

function toUserVenue(v: VenueRow, s: Pick<SubRow, 'nameOverride' | 'categoryOverride' | 'windowDays'>): UserVenue {
  return {
    id: v.id,
    name: s.nameOverride ?? v.name,
    url: v.url,
    city: v.city,
    country: v.country,
    category: (s.categoryOverride ?? v.category) as Category,
    language: v.language,
    timezone: v.timezone,
    createdAt: v.createdAt.toISOString(),
    windowDays: s.windowDays,
    customized: s.nameOverride !== null || s.categoryOverride !== null,
  };
}

export class DbUserVenueStore implements UserVenueStore {
  async list(userId: string): Promise<UserVenue[]> {
    const rows = await getDb()
      .select({ venue: schema.venues, sub: schema.userVenues })
      .from(schema.userVenues)
      .innerJoin(schema.venues, eq(schema.venues.id, schema.userVenues.venueId))
      .where(eq(schema.userVenues.userId, userId));
    return rows
      .map((r) => toUserVenue(r.venue, r.sub))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  async ensureSeeded(userId: string): Promise<void> {
    const db = getDb();
    // One INSERT…SELECT: subscribe to every venue the user isn't already on,
    // but only if they have no subscriptions at all (fresh account). The
    // NOT EXISTS guard makes concurrent first requests idempotent.
    await db.execute(sql`
      INSERT INTO user_venues (user_id, venue_id)
      SELECT ${userId}::uuid, v.id FROM venues v
      WHERE NOT EXISTS (SELECT 1 FROM user_venues uv WHERE uv.user_id = ${userId}::uuid)
      ON CONFLICT DO NOTHING
    `);
  }

  async addCustom(userId: string, input: AddCustomVenueInput): Promise<UserVenue> {
    const db = getDb();
    const url = normalizeVenueUrl(input.url);
    // Re-use the shared row when the URL is already known — this is the
    // scrape-once guarantee. ON CONFLICT DO NOTHING + follow-up select instead
    // of DO UPDATE so user B adding "my kinoteka" can't rename the global row.
    const inserted = await db
      .insert(schema.venues)
      .values({
        name: input.name,
        url,
        city: input.city,
        country: input.country,
        category: input.category,
        language: input.language ?? 'pl',
        timezone: input.timezone ?? 'Europe/Warsaw',
      })
      .onConflictDoNothing({ target: schema.venues.url })
      .returning();
    const venue =
      inserted[0] ??
      (await db.select().from(schema.venues).where(eq(schema.venues.url, url)).limit(1))[0];
    if (!venue) throw new Error(`Venue upsert for ${url} found no row`);

    // If the shared row pre-existed with a different name/category than the
    // user typed, keep their wording as a personal override.
    const isFresh = !!inserted[0];
    const nameOverride = isFresh || venue.name === input.name ? null : input.name;
    const categoryOverride = isFresh || venue.category === input.category ? null : input.category;
    await db
      .insert(schema.userVenues)
      .values({
        userId,
        venueId: venue.id,
        nameOverride,
        categoryOverride,
        windowDays: input.windowDays ?? null,
      })
      .onConflictDoNothing();
    const [sub] = await db
      .select()
      .from(schema.userVenues)
      .where(and(eq(schema.userVenues.userId, userId), eq(schema.userVenues.venueId, venue.id)));
    if (!sub) throw new Error('Subscription insert found no row');
    return toUserVenue(venue, sub);
  }

  async update(userId: string, venueId: string, patch: UpdateUserVenueInput): Promise<UserVenue> {
    const db = getDb();
    const set: Partial<SubRow> = {};
    if (patch.name !== undefined) set.nameOverride = patch.name;
    if (patch.category !== undefined) set.categoryOverride = patch.category;
    if (patch.windowDays !== undefined) set.windowDays = patch.windowDays;
    if (Object.keys(set).length === 0) throw new Error('Nothing to update');
    const [sub] = await db
      .update(schema.userVenues)
      .set(set)
      .where(and(eq(schema.userVenues.userId, userId), eq(schema.userVenues.venueId, venueId)))
      .returning();
    if (!sub) throw new Error('Venue not found in your list');
    const [venue] = await db.select().from(schema.venues).where(eq(schema.venues.id, venueId)).limit(1);
    if (!venue) throw new Error('Venue not found');
    return toUserVenue(venue, sub);
  }

  async remove(userId: string, venueId: string): Promise<boolean> {
    const rows = await getDb()
      .delete(schema.userVenues)
      .where(and(eq(schema.userVenues.userId, userId), eq(schema.userVenues.venueId, venueId)))
      .returning({ venueId: schema.userVenues.venueId });
    return rows.length > 0;
  }

  async maxWindowDays(venueId: string): Promise<number | null> {
    const rows = await getDb()
      .select({ max: max(schema.userVenues.windowDays) })
      .from(schema.userVenues)
      .where(eq(schema.userVenues.venueId, venueId));
    return rows[0]?.max ?? null;
  }
}

// ─── In-memory store (tests / no DATABASE_URL) ──────────────────────────────

interface MemSub {
  nameOverride: string | null;
  categoryOverride: string | null;
  windowDays: number | null;
}

export class InMemoryUserVenueStore implements UserVenueStore {
  private venues: Map<string, Venue>;
  private subs = new Map<string, Map<string, MemSub>>(); // userId -> venueId -> sub
  private seq = 0;

  constructor(seedVenues: Venue[] = DEFAULT_VENUES) {
    this.venues = new Map(seedVenues.map((v) => [v.id, v]));
  }

  private userSubs(userId: string): Map<string, MemSub> {
    let m = this.subs.get(userId);
    if (!m) this.subs.set(userId, (m = new Map()));
    return m;
  }

  async list(userId: string): Promise<UserVenue[]> {
    const out: UserVenue[] = [];
    for (const [venueId, sub] of this.userSubs(userId)) {
      const v = this.venues.get(venueId);
      if (v) out.push(this.toUserVenue(v, sub));
    }
    return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  async ensureSeeded(userId: string): Promise<void> {
    const subs = this.userSubs(userId);
    if (subs.size > 0) return;
    for (const id of this.venues.keys()) {
      subs.set(id, { nameOverride: null, categoryOverride: null, windowDays: null });
    }
  }

  async addCustom(userId: string, input: AddCustomVenueInput): Promise<UserVenue> {
    const url = normalizeVenueUrl(input.url);
    let venue = [...this.venues.values()].find((v) => v.url === url);
    let created = false;
    if (!venue) {
      this.seq += 1;
      venue = {
        id: `custom-${this.seq}`,
        name: input.name,
        url,
        city: input.city,
        country: input.country,
        category: input.category,
        language: input.language ?? 'pl',
        timezone: input.timezone ?? 'Europe/Warsaw',
        createdAt: new Date().toISOString(),
      };
      this.venues.set(venue.id, venue);
      created = true;
    }
    const subs = this.userSubs(userId);
    if (!subs.has(venue.id)) {
      subs.set(venue.id, {
        nameOverride: created || venue.name === input.name ? null : input.name,
        categoryOverride: created || venue.category === input.category ? null : input.category,
        windowDays: input.windowDays ?? null,
      });
    }
    return this.toUserVenue(venue, subs.get(venue.id)!);
  }

  async update(userId: string, venueId: string, patch: UpdateUserVenueInput): Promise<UserVenue> {
    const sub = this.userSubs(userId).get(venueId);
    const venue = this.venues.get(venueId);
    if (!sub || !venue) throw new Error('Venue not found in your list');
    if (patch.name !== undefined) sub.nameOverride = patch.name;
    if (patch.category !== undefined) sub.categoryOverride = patch.category;
    if (patch.windowDays !== undefined) sub.windowDays = patch.windowDays;
    return this.toUserVenue(venue, sub);
  }

  async remove(userId: string, venueId: string): Promise<boolean> {
    return this.userSubs(userId).delete(venueId);
  }

  async maxWindowDays(venueId: string): Promise<number | null> {
    let out: number | null = null;
    for (const subs of this.subs.values()) {
      const w = subs.get(venueId)?.windowDays ?? null;
      if (w !== null && (out === null || w > out)) out = w;
    }
    return out;
  }

  private toUserVenue(v: Venue, s: MemSub): UserVenue {
    return {
      ...v,
      name: s.nameOverride ?? v.name,
      category: (s.categoryOverride ?? v.category) as Category,
      windowDays: s.windowDays,
      customized: s.nameOverride !== null || s.categoryOverride !== null,
    };
  }
}

export const defaultUserVenueStore: UserVenueStore = process.env.DATABASE_URL
  ? new DbUserVenueStore()
  : new InMemoryUserVenueStore();

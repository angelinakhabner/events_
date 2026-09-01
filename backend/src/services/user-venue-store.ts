import { and, asc, eq, max, sql } from 'drizzle-orm';
import type { Venue, Category } from '@afisz/shared';
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
  /** Which of the user's folders (lists) the subscription sits in. */
  listId: string | null;
  /** Free-form personal tags. */
  tags: string[];
  /** How this venue is read — 'jsonld', 'ical', … — or null if never probed.
   *  Shown on the row so a venue added from a discovery search says how it
   *  will be scraped (GOI-92). */
  sourceMethod: string | null;
  /** Non-null when the last probe failed: the reason this venue won't
   *  populate, kept on the venue rather than discarded (GOI-92). */
  probeErrorCode: string | null;
}

/**
 * What a probe concluded about a URL, as the add path stores it (GOI-92).
 *
 * A venue whose site can't be read is still a real venue, so it is added with
 * the verdict attached instead of being dropped — that is the whole reason
 * these travel with the add rather than being left to the nightly sweep to
 * rediscover.
 */
export interface VenueProbeFacts {
  sourceUrl?: string | null;
  sourceMethod?: string | null;
  sourceConfidence?: string | null;
  requiresPaidFetch?: boolean;
  probeErrorCode?: string | null;
  probeResult?: Record<string, unknown> | null;
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
  /** Which of the user's lists to add the venue to; defaults to the active one. */
  listId?: string;
  /** Free-form personal tags, set at add time (GOI-74). Personal like the
   *  name and category overrides — the shared venue row carries none. */
  tags?: string[];
  /** The discovery probe's verdict for this URL (GOI-92). Written only onto a
   *  venue row this call *creates*: an existing shared row already has its own
   *  probe state, and one user's stale check must not overwrite it. */
  probe?: VenueProbeFacts;
}

/** A named grouping of a user's venue subscriptions (e.g. "Warsaw", "Poznan").
 *  Exactly one list is active per user; the scheduler only scrapes venues
 *  reachable through some user's active list. */
export interface UserList {
  id: string;
  name: string;
  /** The list the user is currently viewing. */
  active: boolean;
  venueCount: number;
  createdAt: string;
}

/** Every fresh account starts with this list, holding the default venues. */
export const DEFAULT_LIST_NAME = 'Warsaw';

/**
 * The folder identity key (GOI-92). Two names that differ only by case or by
 * surrounding whitespace are the same folder — the display form is whatever
 * the user typed first.
 *
 * This must stay byte-for-byte equivalent to `lower(btrim(name))`, the
 * expression the unique index in 0025 is built on: if the two ever disagree,
 * the store believes a folder is free while the database rejects the insert.
 * That is why inner whitespace is deliberately *not* collapsed.
 */
export function normalizeListName(name: string): string {
  return name.trim().toLowerCase();
}

export interface UpdateUserVenueInput {
  /** New personal display name; null clears the override. */
  name?: string | null;
  /** New personal category; null clears the override. */
  category?: Category | null;
  windowDays?: number | null;
  /** Replacement tag set — the caller sends the whole list. */
  tags?: string[];
  /** Move the subscription into another of the user's folders (lists). */
  listId?: string;
}

export interface UserVenueStore {
  /** The user's venues, overrides applied. Scoped to one list: `listId` when
   *  given, otherwise the user's active list (all subscriptions if the user
   *  somehow has no lists yet). */
  list(userId: string, listId?: string): Promise<UserVenue[]>;
  /** Every subscription the user has, across all folders — what the /my
   *  "My venues" tab groups by folder. */
  listAll(userId: string): Promise<UserVenue[]>;
  /** First-login seeding: create the default list, make it active, and
   *  subscribe the user to the curated venues the home page is built from
   *  (`DEFAULT_VENUES`) so /my starts populated. No-op when the user already
   *  has lists/subscriptions. See {@link seedVenueUrls} for why the set is
   *  the curated one rather than "every venue we know of". */
  ensureSeeded(userId: string): Promise<void>;
  /** The user's lists, oldest first, with venue counts + the active flag. */
  lists(userId: string): Promise<UserList[]>;
  /** Create a list. Becomes active only when the user had none. */
  createList(userId: string, name: string): Promise<UserList>;
  /** Get the list with this name, creating it if it doesn't exist (GOI-92).
   *  Matched on the normalised name, so "berlin" finds "Berlin". Idempotent
   *  and safe to race: two calls for one city end up with one folder. */
  ensureList(userId: string, name: string): Promise<UserList>;
  renameList(userId: string, listId: string, name: string): Promise<UserList>;
  /** Delete a list and its subscriptions. If it was active, the oldest
   *  remaining list becomes active. */
  removeList(userId: string, listId: string): Promise<boolean>;
  /** Switch which list the user is viewing (and therefore which is scraped). */
  setActiveList(userId: string, listId: string): Promise<void>;
  /** Add (or re-use, by URL) a venue and subscribe the user to it. */
  addCustom(userId: string, input: AddCustomVenueInput): Promise<UserVenue>;
  /** Edit personal overrides / scrape prefs for one subscription. */
  update(userId: string, venueId: string, patch: UpdateUserVenueInput): Promise<UserVenue>;
  /** Unsubscribe. The shared venue row (and other users) are untouched. */
  remove(userId: string, venueId: string): Promise<boolean>;
  /** Max windowDays over a venue's subscribers, or null when none set one. */
  maxWindowDays(venueId: string): Promise<number | null>;
}

/**
 * The venues a brand-new account is subscribed to (GOI-106).
 *
 * It is `DEFAULT_VENUES`, and the distinction that matters is what it is
 * *not*: the `venues` table. That table is shared — it accumulates a row for
 * every URL any user has ever added through "add a venue", because a venue
 * added twice by two people must stay one row the scraper visits once. Seeding
 * from it meant a new account woke up subscribed to strangers' venues, and to
 * near-duplicates of the curated ones: `venues.url` is unique, so a second
 * spelling of a cinema someone already follows (kinomuranow.pl vs
 * kinomuranow.pl/repertuar) is a second row, and both landed in /my under the
 * same name. That is the duplication the ticket reports, and it can only get
 * worse as the venue table grows.
 *
 * So the seed set is the curated list the home page itself is built from —
 * which is also the only set we can promise is actually scraped and populated.
 * Matched by URL because the DB assigns its own uuids (see `seed.ts`, which
 * upserts these same rows `ON CONFLICT (url)`).
 */
export function seedVenueUrls(seed: Venue[] = DEFAULT_VENUES): string[] {
  // Deduped on the normalised URL rather than the raw one, so two curated
  // entries that differ only in a trailing slash or a #fragment can never
  // subscribe a new user to the same venue twice.
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const v of seed) {
    const key = normalizeVenueUrl(v.url);
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(v.url);
  }
  return urls;
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

type SubFields = Pick<SubRow, 'nameOverride' | 'categoryOverride' | 'windowDays' | 'listId' | 'tags'>;

function toUserVenue(v: VenueRow, s: SubFields): UserVenue {
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
    listId: s.listId,
    tags: s.tags ?? [],
    sourceMethod: v.sourceMethod,
    probeErrorCode: v.probeErrorCode,
  };
}

/** Trim, drop blanks, de-duplicate case-insensitively, cap the length. */
export function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().slice(0, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

export class DbUserVenueStore implements UserVenueStore {
  async list(userId: string, listId?: string): Promise<UserVenue[]> {
    const scope = listId ?? (await this.activeListId(userId));
    const conditions = [eq(schema.userVenues.userId, userId)];
    // No lists at all (legacy account before ensureSeeded ran) → all subs.
    if (scope) conditions.push(eq(schema.userVenues.listId, scope));
    const rows = await getDb()
      .select({ venue: schema.venues, sub: schema.userVenues })
      .from(schema.userVenues)
      .innerJoin(schema.venues, eq(schema.venues.id, schema.userVenues.venueId))
      .where(and(...conditions));
    return rows
      .map((r) => toUserVenue(r.venue, r.sub))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  async listAll(userId: string): Promise<UserVenue[]> {
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
    // Each statement carries its own guard so concurrent first requests stay
    // idempotent. Order matters: list → active pointer → subscriptions.
    // 1. Default list for a user who has none.
    await db.execute(sql`
      INSERT INTO user_lists (user_id, name)
      SELECT ${userId}::uuid, ${DEFAULT_LIST_NAME}
      WHERE NOT EXISTS (SELECT 1 FROM user_lists ul WHERE ul.user_id = ${userId}::uuid)
      ON CONFLICT DO NOTHING
    `);
    // 2. Point the active list at the oldest list when unset.
    await db.execute(sql`
      UPDATE users SET active_list_id = (
        SELECT id FROM user_lists WHERE user_id = ${userId}::uuid ORDER BY created_at ASC LIMIT 1
      )
      WHERE id = ${userId}::uuid AND active_list_id IS NULL
    `);
    // 3. Subscribe a fresh account (no subscriptions at all) to the curated
    //    venues, into the active list. Scoped to `seedVenueUrls()` rather than
    //    the whole `venues` table (GOI-106) — see that function for why.
    //
    //    DISTINCT ON collapses any venue rows that normalise to the same
    //    listing, keeping the oldest, so a duplicate that has already reached
    //    the table cannot become two rows in a new user's /my. `venues.url` is
    //    unique, so this is normally a no-op; it is here because the case it
    //    guards is exactly the one the ticket reports and it costs nothing.
    await db.execute(sql`
      INSERT INTO user_venues (user_id, venue_id, list_id)
      SELECT ${userId}::uuid, v.id, u.active_list_id
      FROM (
        SELECT DISTINCT ON (coalesce(normalized_url, url)) id, created_at
        FROM venues
        WHERE url = ANY(${seedVenueUrls()}::text[])
        ORDER BY coalesce(normalized_url, url), created_at ASC
      ) v
      JOIN users u ON u.id = ${userId}::uuid
      WHERE NOT EXISTS (SELECT 1 FROM user_venues uv WHERE uv.user_id = ${userId}::uuid)
      ON CONFLICT DO NOTHING
    `);
    // 4. Adopt pre-lists legacy subscriptions (list_id IS NULL) into the
    //    active list so they stay visible and scraped.
    await db.execute(sql`
      UPDATE user_venues uv SET list_id = u.active_list_id
      FROM users u
      WHERE u.id = uv.user_id AND uv.user_id = ${userId}::uuid AND uv.list_id IS NULL
    `);
  }

  private async activeListId(userId: string): Promise<string | null> {
    const [row] = await getDb()
      .select({ activeListId: schema.users.activeListId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return row?.activeListId ?? null;
  }

  async lists(userId: string): Promise<UserList[]> {
    const db = getDb();
    const active = await this.activeListId(userId);
    const rows = await db
      .select({
        id: schema.userLists.id,
        name: schema.userLists.name,
        createdAt: schema.userLists.createdAt,
        venueCount: sql<number>`count(${schema.userVenues.venueId})::int`,
      })
      .from(schema.userLists)
      .leftJoin(schema.userVenues, eq(schema.userVenues.listId, schema.userLists.id))
      .where(eq(schema.userLists.userId, userId))
      .groupBy(schema.userLists.id)
      .orderBy(asc(schema.userLists.createdAt));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      active: r.id === active,
      venueCount: r.venueCount,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createList(userId: string, name: string): Promise<UserList> {
    const db = getDb();
    const [row] = await db
      .insert(schema.userLists)
      .values({ userId, name })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new Error(`You already have a list named "${name}"`);
    // First list ever → becomes active.
    await db.execute(sql`
      UPDATE users SET active_list_id = ${row.id}::uuid
      WHERE id = ${userId}::uuid AND active_list_id IS NULL
    `);
    const active = await this.activeListId(userId);
    return {
      id: row.id,
      name: row.name,
      active: row.id === active,
      venueCount: 0,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Find-or-create by normalised name, without a read-then-write window.
   *
   * The insert goes first and the unique index in 0025 arbitrates: whichever
   * concurrent commit loses the race gets no row back and reads the winner's
   * folder instead. Reading first would let two "Berlin" commits both see
   * nothing and both insert — one of which then fails, taking its venues with
   * it.
   */
  async ensureList(userId: string, name: string): Promise<UserList> {
    const display = name.trim();
    if (!display) throw new Error('A folder name is required');
    const db = getDb();

    const [created] = await db
      .insert(schema.userLists)
      .values({ userId, name: display })
      .onConflictDoNothing()
      .returning();

    if (created) {
      // First folder ever → becomes active, same as createList.
      await db.execute(sql`
        UPDATE users SET active_list_id = ${created.id}::uuid
        WHERE id = ${userId}::uuid AND active_list_id IS NULL
      `);
      const active = await this.activeListId(userId);
      return {
        id: created.id,
        name: created.name,
        active: created.id === active,
        venueCount: 0,
        createdAt: created.createdAt.toISOString(),
      };
    }

    const existing = (await this.lists(userId)).find(
      (l) => normalizeListName(l.name) === normalizeListName(display),
    );
    if (!existing) throw new Error(`Could not resolve a folder named "${display}"`);
    return existing;
  }

  async renameList(userId: string, listId: string, name: string): Promise<UserList> {
    const db = getDb();
    let rows: (typeof schema.userLists.$inferSelect)[];
    try {
      rows = await db
        .update(schema.userLists)
        .set({ name })
        .where(and(eq(schema.userLists.id, listId), eq(schema.userLists.userId, userId)))
        .returning();
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error(`You already have a list named "${name}"`);
      throw e;
    }
    const row = rows[0];
    if (!row) throw new Error('List not found');
    const [lists, active] = await Promise.all([this.lists(userId), this.activeListId(userId)]);
    const withCount = lists.find((l) => l.id === row.id);
    return withCount ?? {
      id: row.id, name: row.name, active: row.id === active, venueCount: 0,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async removeList(userId: string, listId: string): Promise<boolean> {
    const db = getDb();
    // Subscriptions cascade via FK; users.active_list_id is nulled by
    // ON DELETE SET NULL — repoint it at the oldest remaining list.
    const deleted = await db
      .delete(schema.userLists)
      .where(and(eq(schema.userLists.id, listId), eq(schema.userLists.userId, userId)))
      .returning({ id: schema.userLists.id });
    if (deleted.length === 0) return false;
    await db.execute(sql`
      UPDATE users SET active_list_id = (
        SELECT id FROM user_lists WHERE user_id = ${userId}::uuid ORDER BY created_at ASC LIMIT 1
      )
      WHERE id = ${userId}::uuid AND active_list_id IS NULL
    `);
    return true;
  }

  async setActiveList(userId: string, listId: string): Promise<void> {
    const db = getDb();
    const [row] = await db
      .select({ id: schema.userLists.id })
      .from(schema.userLists)
      .where(and(eq(schema.userLists.id, listId), eq(schema.userLists.userId, userId)))
      .limit(1);
    if (!row) throw new Error('List not found');
    await db.update(schema.users).set({ activeListId: listId }).where(eq(schema.users.id, userId));
  }

  /** Resolve which list a new subscription goes into: the given list (must be
   *  the user's own), else the active list, creating the default when a user
   *  somehow has none yet. */
  private async resolveTargetList(userId: string, listId?: string): Promise<string> {
    const db = getDb();
    if (listId) {
      const [row] = await db
        .select({ id: schema.userLists.id })
        .from(schema.userLists)
        .where(and(eq(schema.userLists.id, listId), eq(schema.userLists.userId, userId)))
        .limit(1);
      if (!row) throw new Error('List not found');
      return row.id;
    }
    const active = await this.activeListId(userId);
    if (active) return active;
    const created = await this.createList(userId, DEFAULT_LIST_NAME).catch(() => null);
    if (created) return created.id;
    const activeRetry = await this.activeListId(userId);
    if (!activeRetry) throw new Error('Could not resolve a list for this venue');
    return activeRetry;
  }

  async addCustom(userId: string, input: AddCustomVenueInput): Promise<UserVenue> {
    const db = getDb();
    const targetList = await this.resolveTargetList(userId, input.listId);
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
        // Only reaches the table on a fresh insert — the ON CONFLICT below
        // leaves an existing shared row, and its own probe state, alone.
        ...(input.probe
          ? {
              sourceUrl: input.probe.sourceUrl ?? null,
              sourceMethod: input.probe.sourceMethod ?? null,
              sourceConfidence: input.probe.sourceConfidence ?? null,
              requiresPaidFetch: input.probe.requiresPaidFetch ?? false,
              probeErrorCode: input.probe.probeErrorCode ?? null,
              probeResult: input.probe.probeResult ?? null,
              lastProbedAt: new Date(),
            }
          : {}),
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
    // Re-adding a venue you're already subscribed to (from another list)
    // moves it to the target list; overrides and windowDays are kept.
    await db
      .insert(schema.userVenues)
      .values({
        userId,
        venueId: venue.id,
        listId: targetList,
        nameOverride,
        categoryOverride,
        windowDays: input.windowDays ?? null,
        tags: normalizeTags(input.tags ?? []),
      })
      .onConflictDoUpdate({
        target: [schema.userVenues.userId, schema.userVenues.venueId],
        set: { listId: targetList },
      });
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
    if (patch.tags !== undefined) set.tags = normalizeTags(patch.tags);
    if (patch.listId !== undefined) set.listId = await this.resolveTargetList(userId, patch.listId);
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

/** Postgres unique-constraint violation (SQLSTATE 23505). */
function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { code, message } = e as { code?: unknown; message?: unknown };
  return code === '23505' || (typeof message === 'string' && message.includes('duplicate key'));
}

// ─── In-memory store (tests / no DATABASE_URL) ──────────────────────────────

interface MemSub {
  listId: string | null;
  nameOverride: string | null;
  categoryOverride: string | null;
  windowDays: number | null;
  tags: string[];
}

interface MemList {
  id: string;
  name: string;
  createdAt: string;
}

export class InMemoryUserVenueStore implements UserVenueStore {
  private venues: Map<string, Venue>;
  /** Probe verdicts per venue id. The shared `Venue` type carries none, so
   *  they live beside it here the way they live in extra columns in the DB. */
  private probeFacts = new Map<string, VenueProbeFacts>();
  private subs = new Map<string, Map<string, MemSub>>(); // userId -> venueId -> sub
  private userLists = new Map<string, MemList[]>(); // userId -> lists, oldest first
  private activeList = new Map<string, string | null>(); // userId -> listId
  private seq = 0;

  /** The curated set this store was built with — what `ensureSeeded`
   *  subscribes a new user to, as distinct from `this.venues`, which also
   *  collects everything users add later (GOI-106). */
  private readonly seedVenues: Venue[];

  constructor(seedVenues: Venue[] = DEFAULT_VENUES) {
    this.seedVenues = seedVenues;
    this.venues = new Map(seedVenues.map((v) => [v.id, v]));
  }

  private userSubs(userId: string): Map<string, MemSub> {
    let m = this.subs.get(userId);
    if (!m) this.subs.set(userId, (m = new Map()));
    return m;
  }

  private listsOf(userId: string): MemList[] {
    let l = this.userLists.get(userId);
    if (!l) this.userLists.set(userId, (l = []));
    return l;
  }

  async list(userId: string, listId?: string): Promise<UserVenue[]> {
    const scope = listId ?? this.activeList.get(userId) ?? null;
    const out: UserVenue[] = [];
    for (const [venueId, sub] of this.userSubs(userId)) {
      if (scope && sub.listId !== scope) continue;
      const v = this.venues.get(venueId);
      if (v) out.push(this.toUserVenue(v, sub));
    }
    return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  async listAll(userId: string): Promise<UserVenue[]> {
    const out: UserVenue[] = [];
    for (const [venueId, sub] of this.userSubs(userId)) {
      const v = this.venues.get(venueId);
      if (v) out.push(this.toUserVenue(v, sub));
    }
    return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  async ensureSeeded(userId: string): Promise<void> {
    if (this.listsOf(userId).length === 0) {
      await this.createList(userId, DEFAULT_LIST_NAME);
    }
    const active = this.activeList.get(userId) ?? null;
    const subs = this.userSubs(userId);
    if (subs.size === 0) {
      // The curated venues only, deduped — the same rule as the DB store
      // (GOI-106). `this.venues` grows as users add their own, so iterating it
      // subscribed each new account to everyone else's, which is the bug; and
      // tests running against this store must see the production behaviour or
      // they are testing something nobody ships.
      const wanted = new Set(seedVenueUrls(this.seedVenues).map(normalizeVenueUrl));
      const claimed = new Set<string>();
      for (const [id, venue] of this.venues) {
        const key = normalizeVenueUrl(venue.url);
        if (!wanted.has(key) || claimed.has(key)) continue;
        claimed.add(key);
        subs.set(id, { listId: active, nameOverride: null, categoryOverride: null, windowDays: null, tags: [] });
      }
    }
    // Adopt legacy subscriptions into the active list.
    for (const sub of subs.values()) {
      if (sub.listId === null) sub.listId = active;
    }
  }

  async lists(userId: string): Promise<UserList[]> {
    const active = this.activeList.get(userId) ?? null;
    return this.listsOf(userId).map((l) => {
      let venueCount = 0;
      for (const sub of this.userSubs(userId).values()) {
        if (sub.listId === l.id) venueCount++;
      }
      return { ...l, active: l.id === active, venueCount };
    });
  }

  async createList(userId: string, name: string): Promise<UserList> {
    const lists = this.listsOf(userId);
    // Normalised, like the unique index the DB store relies on — otherwise
    // tests running against this store never see the collision that
    // production would raise.
    if (lists.some((l) => normalizeListName(l.name) === normalizeListName(name))) {
      throw new Error(`You already have a list named "${name}"`);
    }
    this.seq += 1;
    const list: MemList = { id: `list-${this.seq}`, name: name.trim(), createdAt: new Date().toISOString() };
    lists.push(list);
    if (!this.activeList.get(userId)) this.activeList.set(userId, list.id);
    return { ...list, active: this.activeList.get(userId) === list.id, venueCount: 0 };
  }

  async ensureList(userId: string, name: string): Promise<UserList> {
    const display = name.trim();
    if (!display) throw new Error('A folder name is required');
    const existing = this.listsOf(userId).find(
      (l) => normalizeListName(l.name) === normalizeListName(display),
    );
    if (existing) return (await this.lists(userId)).find((l) => l.id === existing.id)!;
    return this.createList(userId, display);
  }

  async renameList(userId: string, listId: string, name: string): Promise<UserList> {
    const lists = this.listsOf(userId);
    const list = lists.find((l) => l.id === listId);
    if (!list) throw new Error('List not found');
    if (lists.some((l) => l.id !== listId && normalizeListName(l.name) === normalizeListName(name))) {
      throw new Error(`You already have a list named "${name}"`);
    }
    list.name = name;
    return (await this.lists(userId)).find((l) => l.id === listId)!;
  }

  async removeList(userId: string, listId: string): Promise<boolean> {
    const lists = this.listsOf(userId);
    const idx = lists.findIndex((l) => l.id === listId);
    if (idx === -1) return false;
    lists.splice(idx, 1);
    // Subscriptions in the list go with it (FK cascade in the DB store).
    for (const [venueId, sub] of this.userSubs(userId)) {
      if (sub.listId === listId) this.userSubs(userId).delete(venueId);
    }
    if (this.activeList.get(userId) === listId) {
      this.activeList.set(userId, lists[0]?.id ?? null);
    }
    return true;
  }

  async setActiveList(userId: string, listId: string): Promise<void> {
    if (!this.listsOf(userId).some((l) => l.id === listId)) throw new Error('List not found');
    this.activeList.set(userId, listId);
  }

  async addCustom(userId: string, input: AddCustomVenueInput): Promise<UserVenue> {
    let targetList = input.listId ?? this.activeList.get(userId) ?? null;
    if (input.listId && !this.listsOf(userId).some((l) => l.id === input.listId)) {
      throw new Error('List not found');
    }
    if (!targetList) targetList = (await this.createList(userId, DEFAULT_LIST_NAME)).id;
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
      if (input.probe) this.probeFacts.set(venue.id, input.probe);
      created = true;
    }
    const subs = this.userSubs(userId);
    const existing = subs.get(venue.id);
    if (existing) {
      // Re-adding moves the subscription to the target list, keeping overrides.
      existing.listId = targetList;
    } else {
      subs.set(venue.id, {
        listId: targetList,
        nameOverride: created || venue.name === input.name ? null : input.name,
        categoryOverride: created || venue.category === input.category ? null : input.category,
        windowDays: input.windowDays ?? null,
        tags: normalizeTags(input.tags ?? []),
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
    if (patch.tags !== undefined) sub.tags = normalizeTags(patch.tags);
    if (patch.listId !== undefined) {
      if (!this.listsOf(userId).some((l) => l.id === patch.listId)) throw new Error('List not found');
      sub.listId = patch.listId;
    }
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
      listId: s.listId,
      tags: [...s.tags],
      sourceMethod: this.probeFacts.get(v.id)?.sourceMethod ?? null,
      probeErrorCode: this.probeFacts.get(v.id)?.probeErrorCode ?? null,
    };
  }
}

export const defaultUserVenueStore: UserVenueStore = process.env.DATABASE_URL
  ? new DbUserVenueStore()
  : new InMemoryUserVenueStore();

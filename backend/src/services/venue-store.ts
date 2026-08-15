import type { Venue, VenueListInput, Category } from '@afisz/shared';
import { DEFAULT_VENUES } from '../data/default-venues.js';
import { getDb, schema } from '../db/index.js';
import { and, eq, or } from 'drizzle-orm';
import { normalizedHref } from './probe/normalize.js';

/**
 * What a probe already worked out about a venue (GOI-72 §6). Returned when a
 * URL is already known, so a second user adding the same venue gets the stored
 * answer instead of a second round of fetches.
 */
export interface VenueProbeState {
  id: string;
  name: string;
  language: string;
  sourceUrl: string | null;
  sourceMethod: string | null;
  sourceConfidence: string | null;
}

export interface IVenueStore {
  list(filter?: VenueListInput): Venue[] | Promise<Venue[]>;
  get(id: string): Venue | undefined | Promise<Venue | undefined>;
  add?(input: Omit<Venue, 'id' | 'createdAt'>): Venue;
  cities(): string[] | Promise<string[]>;
  categories(): Category[] | Promise<Category[]>;
  /** Look a venue up by its canonical URL — the dedup key. */
  findByNormalizedUrl?(
    normalizedUrl: string,
  ): VenueProbeState | null | Promise<VenueProbeState | null>;
}

// In-memory venue store. Used for tests and as a fallback when DATABASE_URL is unset.
export class VenueStore implements IVenueStore {
  private venues: Map<string, Venue>;

  constructor(seed: Venue[] = DEFAULT_VENUES) {
    this.venues = new Map(seed.map((v) => [v.id, v]));
  }

  list(filter: VenueListInput = {}): Venue[] {
    const { city, country, category } = filter;
    return [...this.venues.values()].filter((v) => {
      if (city && v.city.toLowerCase() !== city.toLowerCase()) return false;
      if (country && v.country.toLowerCase() !== country.toLowerCase()) return false;
      if (category && v.category !== category) return false;
      return true;
    });
  }

  get(id: string): Venue | undefined {
    return this.venues.get(id);
  }

  add(input: Omit<Venue, 'id' | 'createdAt'>): Venue {
    const id = slug(input.name);
    if (this.venues.has(id)) {
      throw new Error(`Venue with id "${id}" already exists`);
    }
    const venue: Venue = {
      ...input,
      id,
      createdAt: new Date().toISOString(),
    };
    this.venues.set(id, venue);
    return venue;
  }

  remove(id: string): boolean {
    return this.venues.delete(id);
  }

  cities(): string[] {
    return [...new Set([...this.venues.values()].map((v) => v.city))].sort();
  }

  categories(): Category[] {
    return [...new Set([...this.venues.values()].map((v) => v.category))].sort() as Category[];
  }

  /** The seeded venues predate the probe, so they carry no stored method —
   *  matching on the raw URL is the best this store can do, and a null method
   *  simply means the caller probes for real. */
  findByNormalizedUrl(normalizedUrl: string): VenueProbeState | null {
    const match = [...this.venues.values()].find(
      (v) => normalizedHref(v.url) === normalizedUrl,
    );
    if (!match) return null;
    return {
      id: match.id,
      name: match.name,
      language: match.language,
      sourceUrl: match.url,
      sourceMethod: null,
      sourceConfidence: null,
    };
  }
}

export class DbVenueStore implements IVenueStore {
  async list(filter: VenueListInput = {}): Promise<Venue[]> {
    const db = getDb();
    const conditions = [];
    if (filter.city) conditions.push(eq(schema.venues.city, filter.city));
    if (filter.country) conditions.push(eq(schema.venues.country, filter.country));
    if (filter.category) conditions.push(eq(schema.venues.category, filter.category));
    const rows = conditions.length
      ? await db.select().from(schema.venues).where(and(...conditions))
      : await db.select().from(schema.venues);
    return rows.map(rowToVenue);
  }

  async get(id: string): Promise<Venue | undefined> {
    const db = getDb();
    const rows = await db.select().from(schema.venues).where(eq(schema.venues.id, id)).limit(1);
    return rows[0] ? rowToVenue(rows[0]) : undefined;
  }

  async cities(): Promise<string[]> {
    const db = getDb();
    const rows = await db.selectDistinct({ city: schema.venues.city }).from(schema.venues);
    return rows.map((r) => r.city).sort();
  }

  async categories(): Promise<Category[]> {
    const db = getDb();
    const rows = await db.selectDistinct({ category: schema.venues.category }).from(schema.venues);
    return rows.map((r) => r.category).sort() as Category[];
  }

  /**
   * Match on `normalized_url` first — that's the dedup key — then fall back to
   * the raw `url`, because every venue added before GOI-72 has a null
   * normalized column until its next probe.
   */
  async findByNormalizedUrl(normalizedUrl: string): Promise<VenueProbeState | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.venues)
      .where(
        or(eq(schema.venues.normalizedUrl, normalizedUrl), eq(schema.venues.url, normalizedUrl)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      language: row.language,
      sourceUrl: row.sourceUrl ?? row.url,
      sourceMethod: row.sourceMethod,
      sourceConfidence: row.sourceConfidence,
    };
  }
}

function rowToVenue(row: typeof schema.venues.$inferSelect): Venue {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    city: row.city,
    country: row.country,
    category: row.category as Category,
    language: row.language,
    timezone: row.timezone,
    createdAt: row.createdAt.toISOString(),
  };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// When DATABASE_URL is set we serve venues from the DB so the venue ids
// returned to the frontend match the venue_id column on events. Without this,
// Home loads events scraped against DB venues (UUIDs) but the venue map from
// venues.list was the slug-id seed — so every card rendered "Unknown venue".
// Local dev / test still falls back to the slug-id store.
export const defaultVenueStore: IVenueStore = process.env.DATABASE_URL
  ? new DbVenueStore()
  : new VenueStore();

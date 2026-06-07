import type { Venue, VenueListInput, Category } from '@goin/shared';
import { DEFAULT_VENUES } from '../data/default-venues.js';
import { getDb, schema } from '../db/index.js';
import { and, eq } from 'drizzle-orm';

export interface IVenueStore {
  list(filter?: VenueListInput): Venue[] | Promise<Venue[]>;
  get(id: string): Venue | undefined | Promise<Venue | undefined>;
  add?(input: Omit<Venue, 'id' | 'createdAt'>): Venue;
  cities(): string[] | Promise<string[]>;
  categories(): Category[] | Promise<Category[]>;
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

// Keep the tRPC venues procedures backed by the in-memory store for now —
// folder partitioning + existing integration tests rely on the stable
// slug ids (e.g. "kino-muranow"). The scraper, seed script, and DB-backed
// event reads query the venues table directly via Drizzle.
export const defaultVenueStore: IVenueStore = new VenueStore();

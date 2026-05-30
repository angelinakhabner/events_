import type { Venue, VenueListInput, Category } from '@goin/shared';
import { DEFAULT_VENUES } from '../data/default-venues.js';

// In-memory venue store. Swap for the Drizzle-backed implementation when
// DATABASE_URL is wired up — the interface stays the same.
export class VenueStore {
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

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export const defaultVenueStore = new VenueStore();

import { describe, it, expect } from 'vitest';
import { VenueStore } from './venue-store.js';
import type { Venue } from '@goin/shared';

const sample: Venue[] = [
  { id: 'a', name: 'A', url: 'https://a', city: 'Warsaw', country: 'Poland', category: 'cinema', language: 'pl', createdAt: '' },
  { id: 'b', name: 'B', url: 'https://b', city: 'Berlin', country: 'Germany', category: 'theatre', language: 'de', createdAt: '' },
  { id: 'c', name: 'C', url: 'https://c', city: 'Warsaw', country: 'Poland', category: 'theatre', language: 'pl', createdAt: '' },
];

describe('VenueStore', () => {
  it('lists all venues with no filter', () => {
    expect(new VenueStore(sample).list()).toHaveLength(3);
  });

  it('filters by city case-insensitively', () => {
    const r = new VenueStore(sample).list({ city: 'warsaw' });
    expect(r.map((v) => v.id)).toEqual(['a', 'c']);
  });

  it('filters by country and category combined', () => {
    const r = new VenueStore(sample).list({ country: 'Poland', category: 'theatre' });
    expect(r.map((v) => v.id)).toEqual(['c']);
  });

  it('adds a venue and assigns a slug id', () => {
    const store = new VenueStore([]);
    const v = store.add({
      name: 'Kino Praha',
      url: 'https://praha',
      city: 'Prague',
      country: 'Czechia',
      category: 'cinema',
      language: 'cs',
    });
    expect(v.id).toBe('kino-praha');
    expect(store.list({ city: 'Prague' })).toHaveLength(1);
  });

  it('returns sorted unique cities and categories', () => {
    const s = new VenueStore(sample);
    expect(s.cities()).toEqual(['Berlin', 'Warsaw']);
    expect(s.categories()).toEqual(['cinema', 'theatre']);
  });
});

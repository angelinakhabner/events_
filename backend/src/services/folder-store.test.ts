import { describe, it, expect } from 'vitest';
import { FolderStore } from './folder-store.js';

describe('FolderStore', () => {
  it('creates folders with stable ids and lists them in creation order', () => {
    const s = new FolderStore();
    const a = s.create({ name: 'A', venueIds: [], filters: {} });
    const b = s.create({ name: 'B', venueIds: [], filters: {} });
    expect(s.list().map((f) => f.id)).toEqual([a.id, b.id]);
  });

  it('updates only the provided fields', () => {
    const s = new FolderStore();
    const f = s.create({ name: 'A', venueIds: ['v1'], filters: { categories: ['cinema'] } });
    const renamed = s.update({ id: f.id, name: 'A renamed' });
    expect(renamed.name).toBe('A renamed');
    expect(renamed.venueIds).toEqual(['v1']);
    expect(renamed.filters.categories).toEqual(['cinema']);
  });

  it('throws when updating a missing folder', () => {
    expect(() => new FolderStore().update({ id: 'nope', name: 'x' })).toThrow(/not found/);
  });

  it('delete returns false for missing ids', () => {
    expect(new FolderStore().delete('nope')).toBe(false);
  });
});

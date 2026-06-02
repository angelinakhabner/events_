import { describe, it, expect } from 'vitest';
import { InMemoryFolderStore } from './folder-store.js';

const D = 'device-a';
const E = 'device-b';

describe('InMemoryFolderStore', () => {
  it('partitions folders by deviceId', async () => {
    const s = new InMemoryFolderStore();
    await s.create({ deviceId: D, name: 'A', venueIds: [], filters: {} });
    await s.create({ deviceId: E, name: 'B', venueIds: [], filters: {} });
    expect((await s.list(D)).map((f) => f.name)).toEqual(['A']);
    expect((await s.list(E)).map((f) => f.name)).toEqual(['B']);
  });

  it('updates only the provided fields', async () => {
    const s = new InMemoryFolderStore();
    const f = await s.create({ deviceId: D, name: 'A', venueIds: ['v1'], filters: { categories: ['cinema'] } });
    const renamed = await s.update({ deviceId: D, id: f.id, name: 'A renamed' });
    expect(renamed.name).toBe('A renamed');
    expect(renamed.venueIds).toEqual(['v1']);
    expect(renamed.filters.categories).toEqual(['cinema']);
  });

  it('forbids cross-device update', async () => {
    const s = new InMemoryFolderStore();
    const f = await s.create({ deviceId: D, name: 'A', venueIds: [], filters: {} });
    await expect(s.update({ deviceId: E, id: f.id, name: 'x' })).rejects.toThrow(/forbidden/i);
  });

  it('forbids cross-device delete', async () => {
    const s = new InMemoryFolderStore();
    const f = await s.create({ deviceId: D, name: 'A', venueIds: [], filters: {} });
    await expect(s.delete(E, f.id)).rejects.toThrow(/forbidden/i);
  });

  it('delete returns false for missing ids', async () => {
    expect(await new InMemoryFolderStore().delete(D, 'nope')).toBe(false);
  });
});

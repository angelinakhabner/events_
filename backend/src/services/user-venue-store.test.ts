import { describe, it, expect } from 'vitest';
import {
  InMemoryUserVenueStore,
  normalizeListName,
  normalizeTags,
  normalizeVenueUrl,
} from './user-venue-store.js';
import { DEFAULT_VENUES } from '../data/default-venues.js';

const KINOTEKA = { name: 'Kinoteka', url: 'https://kinoteka.pl/repertuar/', category: 'cinema' as const, city: 'Warsaw', country: 'PL' };

describe('InMemoryUserVenueStore', () => {
  it('ensureSeeded gives a fresh user every default venue, once', async () => {
    const s = new InMemoryUserVenueStore();
    await s.ensureSeeded('u1');
    await s.ensureSeeded('u1'); // idempotent
    const venues = await s.list('u1');
    expect(venues).toHaveLength(DEFAULT_VENUES.length);
  });

  it('two users adding the same URL share ONE venue row (scrape-once)', async () => {
    const s = new InMemoryUserVenueStore([]);
    const a = await s.addCustom('u1', { ...KINOTEKA });
    const b = await s.addCustom('u2', { ...KINOTEKA, name: 'Moje kino' });
    expect(b.id).toBe(a.id); // same shared venue
    expect(b.name).toBe('Moje kino'); // but u2 sees their own name
    expect((await s.list('u1'))[0]!.name).toBe('Kinoteka'); // u1 unaffected
  });

  it('name/category edits are personal overrides, not global', async () => {
    const s = new InMemoryUserVenueStore();
    await s.ensureSeeded('u1');
    await s.ensureSeeded('u2');
    const [v] = await s.list('u1');
    const updated = await s.update('u1', v!.id, { name: 'Moja nazwa', category: 'other' });
    expect(updated.name).toBe('Moja nazwa');
    expect(updated.category).toBe('other');
    expect(updated.customized).toBe(true);

    const u2View = (await s.list('u2')).find((x) => x.id === v!.id)!;
    expect(u2View.name).toBe(v!.name);
    expect(u2View.customized).toBe(false);
  });

  it('clearing an override (null) restores the shared values', async () => {
    const s = new InMemoryUserVenueStore();
    await s.ensureSeeded('u1');
    const [v] = await s.list('u1');
    await s.update('u1', v!.id, { name: 'Temp' });
    const reset = await s.update('u1', v!.id, { name: null });
    expect(reset.name).toBe(v!.name);
    expect(reset.customized).toBe(false);
  });

  it('remove unsubscribes only that user', async () => {
    const s = new InMemoryUserVenueStore([]);
    const a = await s.addCustom('u1', { ...KINOTEKA });
    await s.addCustom('u2', { ...KINOTEKA });
    expect(await s.remove('u1', a.id)).toBe(true);
    expect(await s.list('u1')).toHaveLength(0);
    expect(await s.list('u2')).toHaveLength(1);
  });

  it('maxWindowDays is the max across subscribers, null when none set one', async () => {
    const s = new InMemoryUserVenueStore([]);
    const v = await s.addCustom('u1', { ...KINOTEKA });
    expect(await s.maxWindowDays(v.id)).toBeNull();
    await s.update('u1', v.id, { windowDays: 14 });
    await s.addCustom('u2', { ...KINOTEKA, windowDays: 60 });
    expect(await s.maxWindowDays(v.id)).toBe(60);
  });

  it('update on a venue the user does not have throws "not found"', async () => {
    const s = new InMemoryUserVenueStore([]);
    await expect(s.update('u1', 'nope', { name: 'x' })).rejects.toThrow(/not found/i);
  });
});

describe('InMemoryUserVenueStore — lists', () => {
  it('ensureSeeded creates an active "Warsaw" list holding the default venues', async () => {
    const s = new InMemoryUserVenueStore();
    await s.ensureSeeded('u1');
    const lists = await s.lists('u1');
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: 'Warsaw', active: true, venueCount: DEFAULT_VENUES.length });
  });

  it('a new list starts empty and does NOT steal the active flag', async () => {
    const s = new InMemoryUserVenueStore();
    await s.ensureSeeded('u1');
    const poznan = await s.createList('u1', 'Poznan');
    expect(poznan.active).toBe(false);
    const lists = await s.lists('u1');
    expect(lists.find((l) => l.name === 'Warsaw')!.active).toBe(true);
    expect(await s.list('u1', poznan.id)).toHaveLength(0);
  });

  it('setActiveList switches which list list() shows', async () => {
    const s = new InMemoryUserVenueStore();
    await s.ensureSeeded('u1');
    const poznan = await s.createList('u1', 'Poznan');
    await s.setActiveList('u1', poznan.id);
    expect(await s.list('u1')).toHaveLength(0); // active list is now the empty Poznan
    const lists = await s.lists('u1');
    expect(lists.find((l) => l.name === 'Poznan')!.active).toBe(true);
  });

  it('addCustom lands in the active list; re-adding moves the venue between lists', async () => {
    const s = new InMemoryUserVenueStore();
    await s.ensureSeeded('u1');
    const poznan = await s.createList('u1', 'Poznan');
    await s.setActiveList('u1', poznan.id);
    const v = await s.addCustom('u1', { ...KINOTEKA, name: 'Kino Pałacowe', url: 'https://palacowe.example/' });
    expect((await s.list('u1', poznan.id)).map((x) => x.id)).toContain(v.id);

    // Re-adding the same URL while another list is active moves it there.
    const lists = await s.lists('u1');
    const warsaw = lists.find((l) => l.name === 'Warsaw')!;
    await s.setActiveList('u1', warsaw.id);
    await s.addCustom('u1', { ...KINOTEKA, name: 'Kino Pałacowe', url: 'https://palacowe.example/' });
    expect((await s.list('u1', poznan.id)).map((x) => x.id)).not.toContain(v.id);
    expect((await s.list('u1', warsaw.id)).map((x) => x.id)).toContain(v.id);
  });

  it('duplicate list names are rejected', async () => {
    const s = new InMemoryUserVenueStore();
    await s.ensureSeeded('u1');
    await expect(s.createList('u1', 'Warsaw')).rejects.toThrow(/already have/i);
    const poznan = await s.createList('u1', 'Poznan');
    await expect(s.renameList('u1', poznan.id, 'Warsaw')).rejects.toThrow(/already have/i);
  });

  it('removing the active list drops its venues and activates the oldest remaining list', async () => {
    const s = new InMemoryUserVenueStore();
    await s.ensureSeeded('u1');
    const poznan = await s.createList('u1', 'Poznan');
    await s.setActiveList('u1', poznan.id);
    await s.addCustom('u1', { ...KINOTEKA, name: 'Kino Pałacowe', url: 'https://palacowe.example/' });

    expect(await s.removeList('u1', poznan.id)).toBe(true);
    const lists = await s.lists('u1');
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: 'Warsaw', active: true });
    // The Poznan-only subscription went with the list.
    expect((await s.list('u1', lists[0]!.id)).some((v) => v.url === 'https://palacowe.example/')).toBe(false);
  });

  it('lists are per-user', async () => {
    const s = new InMemoryUserVenueStore();
    await s.ensureSeeded('u1');
    await s.ensureSeeded('u2');
    const poznan = await s.createList('u1', 'Poznan');
    expect((await s.lists('u2')).map((l) => l.name)).toEqual(['Warsaw']);
    await expect(s.setActiveList('u2', poznan.id)).rejects.toThrow(/not found/i);
  });
});

// GOI-25: the "My venues" tab lists everything at once, grouped by folder, so
// each row has to carry its own folder and tags.
describe('InMemoryUserVenueStore — folders and tags', () => {
  it('listAll spans every folder, while list() stays scoped to the active one', async () => {
    const s = new InMemoryUserVenueStore([]);
    await s.ensureSeeded('u1');
    const warsaw = (await s.lists('u1'))[0]!;
    await s.addCustom('u1', { ...KINOTEKA });
    const poznan = await s.createList('u1', 'Poznan');
    await s.addCustom('u1', { ...KINOTEKA, name: 'Kino Pałacowe', url: 'https://palacowe.example/', listId: poznan.id });

    expect((await s.list('u1')).map((v) => v.name)).toEqual(['Kinoteka']);
    expect((await s.listAll('u1')).map((v) => v.name).sort()).toEqual(['Kino Pałacowe', 'Kinoteka']);
    // Each row says which folder it's in, so the UI can group without a join.
    const all = await s.listAll('u1');
    expect(all.find((v) => v.name === 'Kinoteka')!.listId).toBe(warsaw.id);
    expect(all.find((v) => v.name === 'Kino Pałacowe')!.listId).toBe(poznan.id);
  });

  it('moves a venue between folders without unsubscribing it', async () => {
    const s = new InMemoryUserVenueStore([]);
    await s.ensureSeeded('u1');
    const venue = await s.addCustom('u1', { ...KINOTEKA });
    const poznan = await s.createList('u1', 'Poznan');

    const moved = await s.update('u1', venue.id, { listId: poznan.id });
    expect(moved.listId).toBe(poznan.id);
    expect(await s.listAll('u1')).toHaveLength(1);
    expect(await s.list('u1', poznan.id)).toHaveLength(1);
  });

  it('rejects a move into someone else\'s folder', async () => {
    const s = new InMemoryUserVenueStore([]);
    await s.ensureSeeded('u1');
    await s.ensureSeeded('u2');
    const venue = await s.addCustom('u1', { ...KINOTEKA });
    const theirs = await s.createList('u2', 'Poznan');

    await expect(s.update('u1', venue.id, { listId: theirs.id })).rejects.toThrow(/not found/i);
  });

  it('tags are personal and replace the whole set', async () => {
    const s = new InMemoryUserVenueStore([]);
    const a = await s.addCustom('u1', { ...KINOTEKA });
    await s.addCustom('u2', { ...KINOTEKA });

    expect(a.tags).toEqual([]);
    const tagged = await s.update('u1', a.id, { tags: ['date night', 'walkable'] });
    expect(tagged.tags).toEqual(['date night', 'walkable']);
    // Removing is just a shorter set.
    expect((await s.update('u1', a.id, { tags: ['walkable'] })).tags).toEqual(['walkable']);
    // u2 shares the venue row but not the tags.
    expect((await s.list('u2'))[0]!.tags).toEqual([]);
  });
});

describe('normalizeTags', () => {
  it('trims, drops blanks and de-duplicates case-insensitively', () => {
    expect(normalizeTags([' date night ', '', '   ', 'Date Night', 'walkable'])).toEqual([
      'date night',
      'walkable',
    ]);
  });

  it('caps tag length and count', () => {
    expect(normalizeTags(['x'.repeat(60)])[0]).toHaveLength(40);
    expect(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20);
  });
});

describe('normalizeVenueUrl', () => {
  it('trims and drops fragments so trivially-different URLs dedupe', () => {
    expect(normalizeVenueUrl(' https://kinoteka.pl/repertuar/#top ')).toBe('https://kinoteka.pl/repertuar/');
  });

  it('leaves unparseable input as trimmed text (zod validated upstream)', () => {
    expect(normalizeVenueUrl(' not a url ')).toBe('not a url');
  });
});


describe('normalizeListName', () => {
  /**
   * This has to stay byte-for-byte equivalent to `lower(btrim(name))`, the
   * expression the unique index in 0025 is built on. If the two disagree the
   * store believes a name is free while Postgres rejects the insert, and the
   * Elsewhere flow loses whatever it was committing (GOI-92).
   */
  it('folds case and surrounding whitespace, and nothing else', () => {
    expect(normalizeListName('berlin')).toBe('berlin');
    expect(normalizeListName('Berlin ')).toBe('berlin');
    expect(normalizeListName('  BERLIN')).toBe('berlin');
    // btrim doesn't collapse interior spaces, so neither may this.
    expect(normalizeListName('New  York')).toBe('new  york');
  });
});

describe('ensureList (GOI-92)', () => {
  it('creates once and then returns the same folder for every spelling', async () => {
    const s = new InMemoryUserVenueStore([]);
    const first = await s.ensureList('u1', 'Berlin');
    for (const spelling of ['berlin', 'BERLIN', ' Berlin ']) {
      expect((await s.ensureList('u1', spelling)).id).toBe(first.id);
    }
    expect(await s.lists('u1')).toHaveLength(1);
    // The display form is what was typed first, not the normalised key.
    expect(first.name).toBe('Berlin');
  });

  it('is safe to race — concurrent commits for one city share a folder', async () => {
    const s = new InMemoryUserVenueStore([]);
    const ids = await Promise.all(
      ['Berlin', 'berlin', 'BERLIN'].map((n) => s.ensureList('u1', n)),
    );
    expect(new Set(ids.map((l) => l.id)).size).toBe(1);
    expect(await s.lists('u1')).toHaveLength(1);
  });

  it('keeps folders per user', async () => {
    const s = new InMemoryUserVenueStore([]);
    const mine = await s.ensureList('u1', 'Berlin');
    const theirs = await s.ensureList('u2', 'Berlin');
    expect(theirs.id).not.toBe(mine.id);
  });

  it('refuses a blank name rather than creating an unnameable folder', async () => {
    const s = new InMemoryUserVenueStore([]);
    await expect(s.ensureList('u1', '   ')).rejects.toThrow(/folder name/i);
  });
});

describe('createList and renameList agree with the same key', () => {
  it('rejects a second folder that differs only by case', async () => {
    const s = new InMemoryUserVenueStore([]);
    await s.createList('u1', 'Berlin');
    await expect(s.createList('u1', 'berlin ')).rejects.toThrow(/already have a list/i);
  });

  it('rejects renaming onto another folder, case-insensitively', async () => {
    const s = new InMemoryUserVenueStore([]);
    await s.createList('u1', 'Berlin');
    const poznan = await s.createList('u1', 'Poznan');
    await expect(s.renameList('u1', poznan.id, 'BERLIN')).rejects.toThrow(/already have a list/i);
    // Re-casing a folder's own name is not a collision with itself.
    expect((await s.renameList('u1', poznan.id, 'POZNAN')).name).toBe('POZNAN');
  });
});

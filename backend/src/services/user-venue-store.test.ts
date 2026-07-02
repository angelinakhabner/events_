import { describe, it, expect } from 'vitest';
import { InMemoryUserVenueStore, normalizeVenueUrl } from './user-venue-store.js';
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

describe('normalizeVenueUrl', () => {
  it('trims and drops fragments so trivially-different URLs dedupe', () => {
    expect(normalizeVenueUrl(' https://kinoteka.pl/repertuar/#top ')).toBe('https://kinoteka.pl/repertuar/');
  });

  it('leaves unparseable input as trimmed text (zod validated upstream)', () => {
    expect(normalizeVenueUrl(' not a url ')).toBe('not a url');
  });
});

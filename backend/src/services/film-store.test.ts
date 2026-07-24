import { describe, it, expect } from 'vitest';
import { InMemoryFilmStore } from './film-store.js';

describe('InMemoryFilmStore', () => {
  it('adds titles to the want list and lists them', async () => {
    const store = new InMemoryFilmStore();
    await store.add('u1', 'Dune: Part Two');
    await store.add('u1', 'The Zone of Interest');

    const films = await store.list('u1');
    expect(films.map((f) => f.title)).toEqual(['Dune: Part Two', 'The Zone of Interest']);
    expect(films.every((f) => f.status === 'want')).toBe(true);
  });

  it('rejects duplicate titles case-insensitively', async () => {
    const store = new InMemoryFilmStore();
    await store.add('u1', 'Dune');
    await expect(store.add('u1', '  dune ')).rejects.toThrow(/already have/i);
  });

  it('keeps users separate', async () => {
    const store = new InMemoryFilmStore();
    await store.add('u1', 'Dune');
    expect(await store.list('u2')).toEqual([]);
    await expect(store.add('u2', 'Dune')).resolves.toBeTruthy();
  });

  it('markSeen records venue + comment and moves the film to seen', async () => {
    const store = new InMemoryFilmStore();
    const film = await store.add('u1', 'Perfect Days');
    const seen = await store.markSeen('u1', film.id, { watchedVenue: 'Kino Muranów', comment: 'Loved it' });

    expect(seen.status).toBe('seen');
    expect(seen.watchedVenue).toBe('Kino Muranów');
    expect(seen.comment).toBe('Loved it');
    expect(seen.watchedAt).toBeTruthy();
  });

  it('lists want films before seen films', async () => {
    const store = new InMemoryFilmStore();
    const first = await store.add('u1', 'Seen Film');
    await store.add('u1', 'Want Film');
    await store.markSeen('u1', first.id, {});

    const films = await store.list('u1');
    expect(films.map((f) => f.title)).toEqual(['Want Film', 'Seen Film']);
  });

  it('moveToWant clears the seen details', async () => {
    const store = new InMemoryFilmStore();
    const film = await store.add('u1', 'Anatomy of a Fall');
    await store.markSeen('u1', film.id, { watchedVenue: 'Kinoteka', comment: 'ok' });
    const back = await store.moveToWant('u1', film.id);

    expect(back.status).toBe('want');
    expect(back.watchedVenue).toBeNull();
    expect(back.comment).toBeNull();
    expect(back.watchedAt).toBeNull();
  });

  it('markSeen on an unknown or foreign film throws not found', async () => {
    const store = new InMemoryFilmStore();
    const film = await store.add('u1', 'Dune');
    await expect(store.markSeen('u2', film.id, {})).rejects.toThrow(/not found/i);
  });

  it('remove deletes only the given film and reports success', async () => {
    const store = new InMemoryFilmStore();
    const film = await store.add('u1', 'Dune');
    await store.add('u1', 'Oppenheimer');

    expect(await store.remove('u1', film.id)).toBe(true);
    expect(await store.remove('u1', film.id)).toBe(false);
    expect((await store.list('u1')).map((f) => f.title)).toEqual(['Oppenheimer']);
  });
});

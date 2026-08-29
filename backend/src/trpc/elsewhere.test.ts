import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { appRouter } from './router.js';
import type { AppContext } from './context.js';
import { InMemoryUserVenueStore } from '../services/user-venue-store.js';
import { resetProbeLimits } from '../services/probe/limits.js';
import type { SuggestedVenue } from '../services/venue-suggest.js';

/**
 * "Elsewhere" discovery, end to end through the router (GOI-92).
 *
 * These are the assertions the ticket asks for by name, and they are here
 * rather than against the components because the promises are server-side
 * ones: that the endpoints are authenticated, that a search is bounded, that
 * a city folder appears on commit and only once however many venues (or
 * concurrent commits) land in it, and that a venue whose probe failed is
 * stored *with* the reason instead of being dropped.
 */

const suggestSimilarVenues = vi.fn();
const probeVenueUrl = vi.fn();

vi.mock('../services/venue-suggest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/venue-suggest.js')>();
  return { ...actual, suggestSimilarVenues: (...a: unknown[]) => suggestSimilarVenues(...a) };
});

vi.mock('../services/probe/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/probe/index.js')>();
  return { ...actual, probeVenueUrl: (...a: unknown[]) => probeVenueUrl(...a) };
});

const suggestion: SuggestedVenue = {
  name: 'Hamburger Bahnhof',
  url: 'https://www.smb.museum/hamburger-bahnhof',
  city: 'Berlin',
  country: 'DE',
  category: 'exhibition',
  why: 'A contemporary-art institution in a converted station.',
};

let userVenues: InMemoryUserVenueStore;

/** A context with only what these procedures touch; `user: null` is the
 *  unauthenticated case the gate tests below rely on. */
function ctx(user: { id: string; email: string } | null): AppContext {
  return {
    userVenues,
    venues: { findByNormalizedUrl: async () => undefined },
    user,
  } as unknown as AppContext;
}

const caller = (user: { id: string; email: string } | null = { id: 'u1', email: 'a@b.c' }) =>
  appRouter.createCaller(ctx(user));

/** Seed a folder with something to match against — the search refuses an
 *  empty folder, which is a different test. */
async function seededFolder(userId = 'u1'): Promise<string> {
  await userVenues.ensureSeeded(userId);
  const [folder] = await userVenues.lists(userId);
  return folder!.id;
}

beforeEach(() => {
  userVenues = new InMemoryUserVenueStore();
  resetProbeLimits();
  suggestSimilarVenues.mockReset().mockResolvedValue([suggestion]);
  probeVenueUrl.mockReset().mockResolvedValue({
    status: 'success',
    normalizedUrl: suggestion.url,
    sourceUrl: suggestion.url,
    method: 'jsonld',
    confidence: 'high',
    suggestedName: suggestion.name,
    language: 'de',
    sampleEvents: [],
    shared: false,
  });
});

describe('the endpoints are authenticated, not just the page', () => {
  it.each([
    ['suggestSimilar', () => caller(null).my.venues.suggestSimilar({ listId: 'l1', city: 'Berlin' })],
    ['checkUrl', () => caller(null).my.venues.checkUrl({ url: 'https://example.com' })],
    ['add', () => caller(null).my.venues.add({
      name: 'X', url: 'https://example.com', category: 'theatre',
    })],
  ])('rejects %s without a session', async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('a search is bounded', () => {
  it('refuses more candidates than the cap', async () => {
    const listId = await seededFolder();
    await expect(
      caller().my.venues.suggestSimilar({ listId, city: 'Berlin', limit: 20 }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(suggestSimilarVenues).not.toHaveBeenCalled();
  });

  it('asks for the cap by default', async () => {
    const listId = await seededFolder();
    await caller().my.venues.suggestSimilar({ listId, city: 'Berlin' });
    expect(suggestSimilarVenues).toHaveBeenCalledWith(expect.objectContaining({ limit: 8 }));
  });

  // Without this a script could run the model call in a loop; the candidate
  // cap only bounds one search.
  it('rate-limits repeated searches', async () => {
    const listId = await seededFolder();
    for (let i = 0; i < 5; i++) {
      await caller().my.venues.suggestSimilar({ listId, city: 'Berlin' });
    }
    await expect(
      caller().my.venues.suggestSimilar({ listId, city: 'Berlin' }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(suggestSimilarVenues).toHaveBeenCalledTimes(5);
  });

  it('counts the quota per user', async () => {
    const listId = await seededFolder();
    for (let i = 0; i < 5; i++) {
      await caller().my.venues.suggestSimilar({ listId, city: 'Berlin' });
    }
    const other = { id: 'u2', email: 'c@d.e' };
    const otherFolder = await seededFolder('u2');
    await expect(
      caller(other).my.venues.suggestSimilar({ listId: otherFolder, city: 'Berlin' }),
    ).resolves.toBeTruthy();
  });
});

describe('Firecrawl is never run while discovering', () => {
  it('probes without paid consent unless it is asked for explicitly', async () => {
    await caller().my.venues.checkUrl({ url: 'https://www.smb.museum/hamburger-bahnhof' });
    expect(probeVenueUrl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ allowPaid: false }),
    );
  });
});

describe('the destination folder', () => {
  it('is created on commit, not before', async () => {
    await seededFolder();
    // A search on its own creates nothing — abandoning it leaves no orphan.
    await caller().my.venues.suggestSimilar({ listId: await seededFolder(), city: 'Berlin' });
    expect((await userVenues.lists('u1')).map((l) => l.name)).toEqual(['Warsaw']);

    await caller().my.venues.add({
      name: suggestion.name, url: suggestion.url, city: 'Berlin', country: 'DE',
      category: 'exhibition', listName: 'Berlin',
    });
    const folders = await userVenues.lists('u1');
    expect(folders.map((l) => l.name)).toEqual(['Warsaw', 'Berlin']);
    expect(folders.find((l) => l.name === 'Berlin')!.venueCount).toBe(1);
  });

  it('is reused across spellings rather than duplicated', async () => {
    await seededFolder();
    for (const [i, name] of ['Berlin', 'berlin', 'BERLIN ', ' Berlin'].entries()) {
      await caller().my.venues.add({
        name: `Venue ${i}`, url: `https://example.com/${i}`, city: 'Berlin', country: 'DE',
        category: 'theatre', listName: name,
      });
    }
    const folders = await userVenues.lists('u1');
    expect(folders.filter((l) => l.name.toLowerCase().trim() === 'berlin')).toHaveLength(1);
    expect(folders.find((l) => l.name === 'Berlin')!.venueCount).toBe(4);
  });

  it('survives two commits landing at once', async () => {
    await seededFolder();
    await Promise.all(
      [0, 1, 2].map((i) =>
        caller().my.venues.add({
          name: `Venue ${i}`, url: `https://example.com/${i}`, city: 'Berlin', country: 'DE',
          category: 'theatre', listName: 'Berlin',
        }),
      ),
    );
    expect((await userVenues.lists('u1')).filter((l) => l.name === 'Berlin')).toHaveLength(1);
  });

  it('takes an explicit folder over the city name', async () => {
    const listId = await seededFolder();
    const added = await caller().my.venues.add({
      name: suggestion.name, url: suggestion.url, city: 'Berlin', country: 'DE',
      category: 'exhibition', listId, listName: 'Berlin',
    });
    expect(added.listId).toBe(listId);
    expect((await userVenues.lists('u1')).map((l) => l.name)).toEqual(['Warsaw']);
  });
});

describe('a venue that failed its probe is kept, with the reason', () => {
  it('stores the failure alongside the venue instead of refusing the add', async () => {
    await seededFolder();
    const added = await caller().my.venues.add({
      name: 'Volksbühne', url: 'https://www.volksbuehne.berlin', city: 'Berlin', country: 'DE',
      category: 'theatre', listName: 'Berlin',
      probe: { probeErrorCode: 'BLOCKED', requiresPaidFetch: false },
    });
    expect(added.probeErrorCode).toBe('BLOCKED');

    const listed = await caller().my.venues.listAll();
    expect(listed.find((v) => v.name === 'Volksbühne')?.probeErrorCode).toBe('BLOCKED');
  });

  it('records how a readable venue will be read', async () => {
    await seededFolder();
    const added = await caller().my.venues.add({
      name: suggestion.name, url: suggestion.url, city: 'Berlin', country: 'DE',
      category: 'exhibition', listName: 'Berlin',
      probe: { sourceMethod: 'jsonld', sourceConfidence: 'high', sourceUrl: suggestion.url },
    });
    expect(added.sourceMethod).toBe('jsonld');
    expect(added.probeErrorCode).toBeNull();
  });

  it('flags a paid-render-only venue without anything having been rendered', async () => {
    await seededFolder();
    const added = await caller().my.venues.add({
      name: 'Volksbühne', url: 'https://www.volksbuehne.berlin', city: 'Berlin', country: 'DE',
      category: 'theatre', listName: 'Berlin',
      probe: { probeErrorCode: 'JS_RENDERED_NEEDS_PAID', requiresPaidFetch: true },
    });
    expect(added.probeErrorCode).toBe('JS_RENDERED_NEEDS_PAID');
    expect(probeVenueUrl).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import type { Event } from '@afisz/shared';
import { createNewsletterIssueApi, type NewsletterIssueApiDeps } from './newsletter-issue-api.js';
import { MemoryNewsletterKeyStore, NEWSLETTER_KEY_PREFIX, hashNewsletterKey } from './newsletter-key-store.js';
import { InMemoryNewsletterStore } from './newsletter-store.js';
import { InMemoryUserVenueStore } from './user-venue-store.js';
import { newsletterSaveInput } from './newsletter-input.js';
import { appRouter } from '../trpc/router.js';
import type { AppContext } from '../trpc/context.js';

/**
 * The per-newsletter issue API (GOI-152): what printed.sh, or any service the
 * reader hands a key to, can fetch — and, as much, what it cannot.
 */

const saved: Event = {
  id: 'e1',
  venueId: 'v1',
  title: 'Chungking Express',
  description: 'A film.',
  startsAt: new Date(Date.now() + 20 * 3_600_000).toISOString(),
  endsAt: null,
  category: 'cinema',
  language: null,
  director: 'Wong Kar-wai',
  cast: [],
  durationMinutes: 98,
  priceMin: 2200,
  priceMax: 2200,
  sourceUrl: 'https://example.com/film',
  sourceId: null,
  scrapedAt: new Date().toISOString(),
  venue: { id: 'v1', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
};

const config = newsletterSaveInput.parse({
  email: 'a@b.pl',
  name: 'For the printer',
  sendCadence: 'weekly',
  sendWeekday: 1,
  categoryRules: [{ category: 'cinema' }],
});

let keys: MemoryNewsletterKeyStore;
let newsletter: InMemoryNewsletterStore;
let deps: NewsletterIssueApiDeps;
let configId: string;

beforeEach(async () => {
  keys = new MemoryNewsletterKeyStore();
  newsletter = new InMemoryNewsletterStore();
  configId = (await newsletter.save('u1', config)).id;
  deps = {
    keys,
    newsletter,
    userVenues: new InMemoryUserVenueStore(),
    wantToGo: { list: async () => [saved] } as unknown as NewsletterIssueApiDeps['wantToGo'],
    films: { list: async () => [] } as unknown as NewsletterIssueApiDeps['films'],
    renderPdf: async () => Buffer.from('%PDF-1.7 fake'),
  };
});

function get(path: string, key?: string) {
  return createNewsletterIssueApi(deps).request(path, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
}

describe('GET /latest.json', () => {
  it('refuses a request with no key', async () => {
    const res = await get('/latest.json');
    expect(res.status).toBe(401);
  });

  it('refuses a key that is not one', async () => {
    const res = await get('/latest.json', `${NEWSLETTER_KEY_PREFIX}nope`);
    expect(res.status).toBe(401);
  });

  it('serves the issue of the newsletter the key was made for', async () => {
    const { key } = await keys.issue('u1', configId);
    const res = await get('/latest.json', key);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.newsletter).toMatchObject({ id: configId, name: 'For the printer', cadence: 'weekly' });
    expect(body.wantToGo.reminders).toHaveLength(1);
    expect(body.wantToGo.reminders[0].event).toMatchObject({
      title: 'Chungking Express',
      venue: 'Kinoteka',
      // PLN, not grosze — an outside service should not need to know.
      priceMin: 22,
      url: 'https://example.com/film',
    });
    expect(Array.isArray(body.sections)).toBe(true);
  });

  it('stops working once the key is regenerated, and the new one works', async () => {
    const { key: first } = await keys.issue('u1', configId);
    const { key: second } = await keys.issue('u1', configId);

    expect((await get('/latest.json', first)).status).toBe(401);
    expect((await get('/latest.json', second)).status).toBe(200);
  });

  it('stops working once the key is revoked', async () => {
    const { key } = await keys.issue('u1', configId);
    await keys.revoke('u1', configId);

    expect((await get('/latest.json', key)).status).toBe(401);
  });

  it('answers 404 for a key whose newsletter has been deleted', async () => {
    const { key } = await keys.issue('u1', configId);
    await newsletter.remove('u1', configId);

    expect((await get('/latest.json', key)).status).toBe(404);
  });
});

describe('GET /latest.pdf', () => {
  it('serves the rendered PDF', async () => {
    const { key } = await keys.issue('u1', configId);
    const res = await get('/latest.pdf', key);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline; filename=".+\.pdf"$/);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('%PDF-1.7 fake');
  });

  it('refuses a request with no key', async () => {
    expect((await get('/latest.pdf')).status).toBe(401);
  });
});

describe('newsletter key store', () => {
  it('keeps only a hash of the key, and shows its last four characters', async () => {
    const { key, view } = await keys.issue('u1', configId);

    expect(key.startsWith(NEWSLETTER_KEY_PREFIX)).toBe(true);
    expect(view.lastFour).toBe(key.slice(-4));
    expect(JSON.stringify(view)).not.toContain(key);
    expect(hashNewsletterKey(key)).not.toBe(key);
  });

  it('stamps when a key was last used', async () => {
    const { key } = await keys.issue('u1', configId);
    expect((await keys.view('u1', configId))!.lastUsedAt).toBeNull();

    await keys.resolve(key, new Date('2026-11-18T12:00:00Z'));
    expect((await keys.view('u1', configId))!.lastUsedAt).toBe('2026-11-18T12:00:00.000Z');
  });

  it('will not show or revoke another reader’s key', async () => {
    await keys.issue('u1', configId);

    expect(await keys.view('u2', configId)).toBeNull();
    expect(await keys.revoke('u2', configId)).toBe(false);
    expect(await keys.view('u1', configId)).not.toBeNull();
  });
});

describe('my.newsletter.apiKey', () => {
  function caller(userId: string) {
    return appRouter.createCaller({
      user: { id: userId, email: 'a@b.pl' },
      newsletter,
      newsletterKeys: keys,
    } as unknown as AppContext).my.newsletter.apiKey;
  }

  it('generates a key the API then accepts, and shows only its tail afterwards', async () => {
    const { key } = await caller('u1').generate({ id: configId });
    const { key: view } = await caller('u1').status({ id: configId });

    expect(view!.lastFour).toBe(key.slice(-4));
    expect((await get('/latest.json', key)).status).toBe(200);
  });

  it('treats another reader’s newsletter as not found', async () => {
    await expect(caller('u2').generate({ id: configId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller('u2').status({ id: configId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller('u2').revoke({ id: configId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('revokes', async () => {
    const { key } = await caller('u1').generate({ id: configId });
    expect(await caller('u1').revoke({ id: configId })).toEqual({ revoked: true });
    expect((await caller('u1').status({ id: configId })).key).toBeNull();
    expect((await get('/latest.json', key)).status).toBe(401);
  });
});

import { describe, it, expect } from 'vitest';
import { InMemoryNewsletterStore, type NewsletterSaveInput } from './newsletter-store.js';

function input(over: Partial<NewsletterSaveInput> = {}): NewsletterSaveInput {
  return {
    email: 'reader@example.com',
    frequency: 'daily',
    venueIds: [],
    enabled: true,
    ...over,
  };
}

describe('newsletter unsubscribe tokens (GOI-35)', () => {
  it('mints a token on first save', async () => {
    const store = new InMemoryNewsletterStore();
    await store.save('u1', input());
    const [sub] = await store.listEnabled();
    expect(sub!.unsubscribeToken).toMatch(/^[\w-]{20,}$/);
  });

  it('gives different subscriptions different tokens', async () => {
    const store = new InMemoryNewsletterStore();
    await store.save('u1', input());
    await store.save('u2', input({ email: 'other@example.com' }));
    const subs = await store.listEnabled();
    expect(new Set(subs.map((s) => s.unsubscribeToken)).size).toBe(2);
  });

  it('keeps the token across edits', async () => {
    // Briefs already sitting in an inbox carry the old link; changing the send
    // hour must not turn them into dead ends.
    const store = new InMemoryNewsletterStore();
    await store.save('u1', input());
    const before = (await store.listEnabled())[0]!.unsubscribeToken;
    await store.save('u1', input({ frequency: 'weekly', sendHour: 19 }));
    expect((await store.listEnabled())[0]!.unsubscribeToken).toBe(before);
  });

  it('keeps the subscription out of listEnabled once used', async () => {
    const store = new InMemoryNewsletterStore();
    await store.save('u1', input());
    const token = (await store.listEnabled())[0]!.unsubscribeToken;

    expect(await store.unsubscribeByToken(token)).toEqual({
      status: 'unsubscribed',
      email: 'reader@example.com',
    });
    expect(await store.listEnabled()).toEqual([]);
    expect((await store.get('u1'))?.enabled).toBe(false);
  });

  it('reports a second click as "already", not an error', async () => {
    const store = new InMemoryNewsletterStore();
    await store.save('u1', input());
    const token = (await store.listEnabled())[0]!.unsubscribeToken;
    await store.unsubscribeByToken(token);
    expect(await store.unsubscribeByToken(token)).toEqual({
      status: 'already',
      email: 'reader@example.com',
    });
  });

  it('rejects an unknown or empty token without touching anything', async () => {
    const store = new InMemoryNewsletterStore();
    await store.save('u1', input());
    expect(await store.unsubscribeByToken('nope')).toEqual({ status: 'unknown' });
    expect(await store.unsubscribeByToken('')).toEqual({ status: 'unknown' });
    expect(await store.listEnabled()).toHaveLength(1);
  });

  it('re-enabling in settings restores the same token', async () => {
    const store = new InMemoryNewsletterStore();
    await store.save('u1', input());
    const token = (await store.listEnabled())[0]!.unsubscribeToken;
    await store.unsubscribeByToken(token);
    await store.save('u1', input({ enabled: true }));
    const [sub] = await store.listEnabled();
    expect(sub!.unsubscribeToken).toBe(token);
  });
});

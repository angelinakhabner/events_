import { describe, it, expect, beforeEach, vi } from 'vitest';

// The API reads its key off `env` at request time, so the config module is
// mocked with a mutable object: a test can enable, disable or rotate the key
// between requests without re-importing anything.
const testEnv: Record<string, string | undefined | boolean> = {
  NEWSLETTER_API_KEY: 'test-api-key',
  RESEND_FROM_EMAIL: 'hello@goin.app',
};
vi.mock('../config.js', () => ({ env: testEnv }));

const { createNewsletterApi, bearerToken, keyMatches } = await import('./newsletter-api.js');
const { InMemoryAuthStore } = await import('./auth.js');
const { InMemoryNewsletterStore } = await import('./newsletter-store.js');

const KEY = 'test-api-key';
const auth = { Authorization: `Bearer ${KEY}` };

/** A subscription payload with only the required fields — everything else
 *  should come from the shared schema's defaults. */
const payload = {
  email: 'Ada@Example.com',
  frequency: 'daily' as const,
};

function harness(send = vi.fn().mockResolvedValue({ sent: 0, skipped: 0, failed: 0, outcomes: [] })) {
  const deps = {
    auth: new InMemoryAuthStore(),
    newsletter: new InMemoryNewsletterStore(),
    send,
  };
  return { api: createNewsletterApi(deps), deps, send };
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  testEnv.NEWSLETTER_API_KEY = KEY;
});

describe('auth', () => {
  it('answers 503 on every route when no key is configured', async () => {
    testEnv.NEWSLETTER_API_KEY = undefined;
    const { api } = harness();
    const res = await api.request('/status', { headers: auth });
    expect(res.status).toBe(503);
  });

  it('rejects a request with no Authorization header', async () => {
    const { api } = harness();
    expect((await api.request('/status')).status).toBe(401);
  });

  it('rejects a wrong key', async () => {
    const { api } = harness();
    const res = await api.request('/status', { headers: { Authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  // A key of the right length but wrong content must fail like any other, and
  // must not throw out of timingSafeEqual.
  it('rejects a wrong key of the same length', async () => {
    const { api } = harness();
    const res = await api.request('/status', { headers: { Authorization: `Bearer ${'x'.repeat(KEY.length)}` } });
    expect(res.status).toBe(401);
  });

  it('accepts the configured key', async () => {
    const { api } = harness();
    const res = await api.request('/status', { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe('bearerToken', () => {
  it('reads the token out of a well-formed header', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123');
  });

  it('is case-insensitive on the scheme', () => {
    expect(bearerToken('bearer abc123')).toBe('abc123');
  });

  it('returns null for a missing or non-bearer header', () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('Basic abc123')).toBeNull();
  });
});

describe('keyMatches', () => {
  it('is true only for an exact match', () => {
    expect(keyMatches('secret', 'secret')).toBe(true);
    expect(keyMatches('secrez', 'secret')).toBe(false);
  });

  // Different lengths must not throw — timingSafeEqual does.
  it('is false, not thrown, on a length mismatch', () => {
    expect(keyMatches('short', 'much-longer-key')).toBe(false);
  });
});

describe('POST /subscriptions', () => {
  it('creates the account and the subscription for a new address', async () => {
    const { api, deps } = harness();
    const res = await api.request('/subscriptions', json(payload));
    expect(res.status).toBe(200);
    const body = await res.json();
    // The address is normalized, and the internal user id is never exposed.
    expect(body.email).toBe('ada@example.com');
    expect(body.subscription).toMatchObject({ email: 'ada@example.com', frequency: 'daily', enabled: true });
    expect(body.subscription).not.toHaveProperty('userId');
    expect(await deps.auth.findUserByEmail('ada@example.com')).not.toBeNull();
  });

  it('applies the shared schema defaults for omitted fields', async () => {
    const { api } = harness();
    const { subscription } = await (await api.request('/subscriptions', json(payload))).json();
    expect(subscription).toMatchObject({ sendHour: 8, sendMinute: 0, sendWeekday: 1, venueIds: [], categoryRules: [] });
  });

  it('updates in place rather than creating a second subscription', async () => {
    const { api, deps } = harness();
    await api.request('/subscriptions', json(payload));
    await api.request('/subscriptions', json({ ...payload, frequency: 'weekly', sendHour: 19 }));
    const enabled = await deps.newsletter.listEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0]).toMatchObject({ frequency: 'weekly', sendHour: 19 });
  });

  it('rejects an invalid payload with the offending fields named', async () => {
    const { api } = harness();
    const res = await api.request('/subscriptions', json({ email: 'not-an-email', frequency: 'hourly' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues.map((i: { field: string }) => i.field)).toEqual(
      expect.arrayContaining(['email', 'frequency']),
    );
  });

  it('rejects a non-JSON body', async () => {
    const { api } = harness();
    const res = await api.request('/subscriptions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /subscriptions', () => {
  it('lists the enabled subscriptions without internal ids', async () => {
    const { api } = harness();
    await api.request('/subscriptions', json(payload));
    await api.request('/subscriptions', json({ ...payload, email: 'grace@example.com' }));
    const body = await (await api.request('/subscriptions', { headers: auth })).json();
    expect(body.count).toBe(2);
    expect(body.subscriptions.map((s: { email: string }) => s.email).sort()).toEqual([
      'ada@example.com',
      'grace@example.com',
    ]);
    expect(body.subscriptions[0].subscription).not.toHaveProperty('userId');
  });
});

describe('GET /subscriptions/:email', () => {
  it('finds a subscription regardless of the casing used to ask', async () => {
    const { api } = harness();
    await api.request('/subscriptions', json(payload));
    const res = await api.request('/subscriptions/ADA%40example.com', { headers: auth });
    expect(res.status).toBe(200);
    expect((await res.json()).subscription).toMatchObject({ email: 'ada@example.com' });
  });

  // An address with no account and an account with no subscription are the
  // same 404 on purpose — the difference is a membership disclosure.
  it('answers 404 for an unknown address', async () => {
    const { api } = harness();
    const res = await api.request('/subscriptions/nobody%40example.com', { headers: auth });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /subscriptions/:email', () => {
  it('disables the subscription instead of deleting it', async () => {
    const { api, deps } = harness();
    await api.request('/subscriptions', json({ ...payload, sendHour: 19 }));
    const res = await api.request('/subscriptions/ada%40example.com', { method: 'DELETE', headers: auth });
    expect(res.status).toBe(200);
    expect((await res.json()).subscription.enabled).toBe(false);
    // Dropped from the sender's work list, but the settings survive so a
    // resubscribe isn't a fresh setup.
    expect(await deps.newsletter.listEnabled()).toHaveLength(0);
    const user = await deps.auth.findUserByEmail('ada@example.com');
    expect(await deps.newsletter.get(user!.id)).toMatchObject({ sendHour: 19, enabled: false });
  });

  it('answers 404 for an address that never subscribed', async () => {
    const { api } = harness();
    const res = await api.request('/subscriptions/nobody%40example.com', { method: 'DELETE', headers: auth });
    expect(res.status).toBe(404);
  });
});

describe('POST /send', () => {
  it('runs a real sweep when given no options', async () => {
    const { api, send } = harness();
    const res = await api.request('/send', { method: 'POST', headers: auth });
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith(expect.anything(), expect.any(Date), {
      dryRun: false,
      force: false,
      only: undefined,
    });
  });

  it('passes dryRun, force and only through to the sweep', async () => {
    const { api, send } = harness();
    await api.request('/send', json({ dryRun: true, force: true, only: 'ada@example.com' }));
    expect(send).toHaveBeenCalledWith(expect.anything(), expect.any(Date), {
      dryRun: true,
      force: true,
      only: 'ada@example.com',
    });
  });

  it('reports the sweep result', async () => {
    const send = vi.fn().mockResolvedValue({
      sent: 1,
      skipped: 2,
      failed: 0,
      outcomes: [{ userId: 'u1', email: 'ada@example.com', frequency: 'daily', status: 'sent' }],
    });
    const { api } = harness(send);
    const body = await (await api.request('/send', json({ dryRun: true }))).json();
    expect(body).toMatchObject({ dryRun: true, sent: 1, skipped: 2, failed: 0 });
    expect(body.outcomes).toHaveLength(1);
  });
});

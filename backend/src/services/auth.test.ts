import { describe, it, expect } from 'vitest';
import {
  InMemoryAuthStore,
  requestMagicLink,
  verifyMagicLink,
  userForSession,
  logout,
  normalizeEmail,
} from './auth.js';

const NOW = new Date('2026-07-02T12:00:00Z');

describe('magic-link auth flow', () => {
  it('request → verify mints a session for the (new) user', async () => {
    const store = new InMemoryAuthStore();
    const { token } = await requestMagicLink(store, 'Ala@Example.com', { now: NOW });

    const res = await verifyMagicLink(store, token, { now: NOW });
    expect(res).not.toBeNull();
    expect(res!.user.email).toBe('ala@example.com'); // normalized

    const user = await userForSession(store, res!.sessionToken, { now: NOW });
    expect(user?.id).toBe(res!.user.id);
  });

  it('verifying the same email twice reuses one user', async () => {
    const store = new InMemoryAuthStore();
    const a = await requestMagicLink(store, 'x@y.z', { now: NOW });
    const b = await requestMagicLink(store, 'x@y.z', { now: NOW });
    const r1 = await verifyMagicLink(store, a.token, { now: NOW });
    const r2 = await verifyMagicLink(store, b.token, { now: NOW });
    expect(r1!.user.id).toBe(r2!.user.id);
  });

  it('a magic link is single-use', async () => {
    const store = new InMemoryAuthStore();
    const { token } = await requestMagicLink(store, 'x@y.z', { now: NOW });
    expect(await verifyMagicLink(store, token, { now: NOW })).not.toBeNull();
    expect(await verifyMagicLink(store, token, { now: NOW })).toBeNull();
  });

  it('a magic link expires after 15 minutes', async () => {
    const store = new InMemoryAuthStore();
    const { token } = await requestMagicLink(store, 'x@y.z', { now: NOW });
    const later = new Date(NOW.getTime() + 16 * 60_000);
    expect(await verifyMagicLink(store, token, { now: later })).toBeNull();
  });

  it('a bogus token verifies to null', async () => {
    const store = new InMemoryAuthStore();
    expect(await verifyMagicLink(store, 'not-a-token', { now: NOW })).toBeNull();
  });

  it('logout invalidates the session', async () => {
    const store = new InMemoryAuthStore();
    const { token } = await requestMagicLink(store, 'x@y.z', { now: NOW });
    const res = await verifyMagicLink(store, token, { now: NOW });
    await logout(store, res!.sessionToken);
    expect(await userForSession(store, res!.sessionToken, { now: NOW })).toBeNull();
  });

  it('sessions expire', async () => {
    const store = new InMemoryAuthStore();
    const { token } = await requestMagicLink(store, 'x@y.z', { now: NOW });
    const res = await verifyMagicLink(store, token, { now: NOW });
    const in91days = new Date(NOW.getTime() + 91 * 24 * 3_600_000);
    expect(await userForSession(store, res!.sessionToken, { now: in91days })).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Ala@EXAMPLE.com ')).toBe('ala@example.com');
  });
});

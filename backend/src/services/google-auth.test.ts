import { describe, it, expect } from 'vitest';
import {
  exchangeGoogleCode,
  googleAuthUrl,
  makeState,
  verifyState,
  type GoogleAuthConfig,
} from './google-auth.js';

const CFG: GoogleAuthConfig = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'shhh',
  redirectUri: 'https://api.example.com/auth/google/callback',
};

const NOW = new Date('2026-07-24T10:00:00Z');

/** Unsigned JWT with the given payload — enough for payload-decoding tests. */
function fakeIdToken(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'RS256' })}.${enc(payload)}.sig`;
}

function goodClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: CFG.clientId,
    exp: Math.floor(NOW.getTime() / 1000) + 3600,
    email: 'user@gmail.com',
    email_verified: true,
    ...over,
  };
}

function tokenFetcher(idToken: string | null, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(idToken ? { id_token: idToken } : {}), { status })) as typeof fetch;
}

describe('CSRF state', () => {
  it('round-trips a freshly minted state', () => {
    const state = makeState('key', NOW);
    expect(verifyState(state, 'key', NOW)).toBe(true);
  });

  it('rejects tampering, wrong keys and garbage', () => {
    const state = makeState('key', NOW);
    expect(verifyState(state + 'x', 'key', NOW)).toBe(false);
    expect(verifyState(state, 'other-key', NOW)).toBe(false);
    expect(verifyState('not-a-state', 'key', NOW)).toBe(false);
    expect(verifyState('', 'key', NOW)).toBe(false);
  });

  it('rejects states older than the TTL', () => {
    const state = makeState('key', new Date(NOW.getTime() - 11 * 60_000));
    expect(verifyState(state, 'key', NOW)).toBe(false);
  });
});

describe('googleAuthUrl', () => {
  it('points at Google with the exact client, redirect and scopes', () => {
    const u = new URL(googleAuthUrl(CFG, 'the-state'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe(CFG.clientId);
    expect(u.searchParams.get('redirect_uri')).toBe(CFG.redirectUri);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid email');
    expect(u.searchParams.get('state')).toBe('the-state');
  });
});

describe('exchangeGoogleCode', () => {
  it('returns the verified email from a good id_token', async () => {
    const fetcher = tokenFetcher(fakeIdToken(goodClaims()));
    await expect(exchangeGoogleCode(CFG, 'code', { fetcher, now: NOW })).resolves.toEqual({
      email: 'user@gmail.com',
    });
  });

  it.each([
    ['wrong issuer', goodClaims({ iss: 'https://evil.example' }), /issuer/],
    ['wrong audience', goodClaims({ aud: 'someone-else' }), /audience/],
    ['expired token', goodClaims({ exp: Math.floor(NOW.getTime() / 1000) - 10 }), /expired/],
    ['unverified email', goodClaims({ email_verified: false }), /verified email/],
    ['missing email', goodClaims({ email: undefined }), /verified email/],
  ])('rejects %s', async (_name, claims, message) => {
    const fetcher = tokenFetcher(fakeIdToken(claims));
    await expect(exchangeGoogleCode(CFG, 'code', { fetcher, now: NOW })).rejects.toThrow(message);
  });

  it('rejects a failed token exchange and a missing id_token', async () => {
    await expect(
      exchangeGoogleCode(CFG, 'code', { fetcher: tokenFetcher(null, 400), now: NOW }),
    ).rejects.toThrow(/HTTP 400/);
    await expect(
      exchangeGoogleCode(CFG, 'code', { fetcher: tokenFetcher(null), now: NOW }),
    ).rejects.toThrow(/no id_token/);
  });

  it('sends the code and secret to the token endpoint', async () => {
    let seenUrl = '';
    let seenBody = '';
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(url);
      seenBody = String(init?.body);
      return new Response(JSON.stringify({ id_token: fakeIdToken(goodClaims()) }));
    }) as typeof fetch;
    await exchangeGoogleCode(CFG, 'the-code', { fetcher, now: NOW });

    expect(seenUrl).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(seenBody);
    expect(body.get('code')).toBe('the-code');
    expect(body.get('client_secret')).toBe(CFG.clientSecret);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe(CFG.redirectUri);
  });
});

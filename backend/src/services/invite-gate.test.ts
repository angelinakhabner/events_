import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GATE_HTML,
  NOINDEX,
  ROBOTS_TXT,
  buildCookie,
  clearCookie,
  hashToken,
  looksLikeToken,
  mintToken,
  readCookie,
  redactInvitePath,
} from './invite-gate.js';

/**
 * Unit-level behaviour of the gate (GOI-83). The end-to-end "every route and
 * every procedure is denied" assertions live in the app-level test, which
 * drives the real Hono router.
 */

describe('invite tokens', () => {
  it('mints 32 bytes of base64url — random, not derived from anything', () => {
    const a = mintToken();
    const b = mintToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes → 43 chars
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
  });

  it('is not a JWT — no structure, nothing to decode', () => {
    expect(mintToken()).not.toContain('.');
  });

  it('hashes stably with sha256, and the hash is not the token', () => {
    const token = mintToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });

  it.each([
    ['', 'empty'],
    ['short', 'too short'],
    ['a'.repeat(42), 'one char short'],
    ['a'.repeat(44), 'one char long'],
    ['!'.repeat(43), 'wrong alphabet'],
    ['a'.repeat(20) + '/' + 'b'.repeat(22), 'base64 not base64url'],
  ])('rejects a %s token by shape, before any query', (value) => {
    expect(looksLikeToken(value)).toBe(false);
  });

  it('accepts a freshly minted one', () => {
    expect(looksLikeToken(mintToken())).toBe(true);
  });
});

describe('cookie', () => {
  it('is httpOnly, path-wide and long-lived', () => {
    const cookie = buildCookie('tok', true);
    expect(cookie).toContain('afisz_invite=tok');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain(`Max-Age=${90 * 24 * 60 * 60}`);
  });

  // The SPA and the API are separate origins in this deployment, so a Lax
  // cookie would never be sent on an API call and the gate would lock out the
  // people it invited.
  it('is SameSite=None; Secure over HTTPS so it survives a cross-site call', () => {
    const cookie = buildCookie('tok', true);
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Secure');
  });

  it('falls back to Lax on plain-HTTP localhost, where Secure would be dropped', () => {
    const cookie = buildCookie('tok', false);
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });

  it('clears with an immediate expiry', () => {
    expect(clearCookie(true)).toContain('Max-Age=0');
  });

  it('reads its own value out of a crowded Cookie header', () => {
    expect(readCookie('other=1; afisz_invite=abc; third=2')).toBe('abc');
    expect(readCookie('afisz_invite=abc')).toBe('abc');
  });

  it('returns null when absent, empty or malformed', () => {
    expect(readCookie(undefined)).toBeNull();
    expect(readCookie('')).toBeNull();
    expect(readCookie('other=1')).toBeNull();
    expect(readCookie('afisz_invite=')).toBeNull();
  });
});

describe('search engines', () => {
  it('disallows everything in robots.txt', () => {
    expect(ROBOTS_TXT).toContain('User-agent: *');
    expect(ROBOTS_TXT).toContain('Disallow: /');
  });

  it('says noindex and nofollow', () => {
    expect(NOINDEX).toContain('noindex');
    expect(NOINDEX).toContain('nofollow');
  });

  // Nothing worth indexing, and nothing that tells a stranger what this is.
  it('gives the gate page no venue names, no event data, no descriptive copy', () => {
    expect(GATE_HTML).toContain('Not available');
    expect(GATE_HTML).toContain(NOINDEX);
    expect(GATE_HTML).not.toMatch(/afisz|goin|teatr|kino|event|wydarzen/i);
  });
});

describe('log redaction', () => {
  // /i/<token> in an access log hands the gate to anyone who can read logs.
  it('redacts the token out of an invite path', () => {
    const token = mintToken();
    const redacted = redactInvitePath(`/i/${token}`);
    expect(redacted).toBe('/i/[redacted]');
    expect(redacted).not.toContain(token);
  });

  it('redacts before a query string, and leaves other paths alone', () => {
    expect(redactInvitePath('/i/abc?x=1')).toBe('/i/[redacted]?x=1');
    expect(redactInvitePath('/trpc/events.listDefault')).toBe('/trpc/events.listDefault');
    expect(redactInvitePath('/health')).toBe('/health');
  });
});

// ─── middleware, against a stubbed store ─────────────────────────────────────

const valid = vi.fn<(token: string) => Promise<boolean>>();

vi.mock('../db/index.js', () => ({
  getDb: () => { throw new Error('no db in unit tests'); },
  schema: { invites: '__invites__' },
}));

describe('isTokenValid degrades safely', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.resetModules());

  it('fails closed when the database is unreachable', async () => {
    const { isTokenValid } = await import('./invite-gate.js');
    // getDb throws (mocked above); a gate that fails open is not a gate.
    await expect(isTokenValid(mintToken())).resolves.toBe(false);
  });

  it('rejects a malformed token without touching the database at all', async () => {
    const { isTokenValid } = await import('./invite-gate.js');
    await expect(isTokenValid('garbage')).resolves.toBe(false);
  });

  it('never throws on hostile input', async () => {
    const { isTokenValid } = await import('./invite-gate.js');
    for (const bad of ['', '../../etc/passwd', '%00', 'a'.repeat(5000)]) {
      await expect(isTokenValid(bad)).resolves.toBe(false);
    }
  });
});

void valid;

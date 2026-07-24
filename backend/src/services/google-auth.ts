import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config.js';

// "Sign in with Google" — plain OAuth 2.0 / OIDC authorization-code flow, no
// SDK. The browser is sent to Google's consent screen; Google redirects back
// to <API_PUBLIC_URL>/auth/google/callback with a code; the backend exchanges
// the code server-side and reads the verified email from the id_token that
// Google's token endpoint returns directly over TLS (per OIDC §3.1.3.7 the
// signature check is not required when the token comes straight from the
// token endpoint — we validate iss/aud/exp/email_verified instead).
//
// CSRF protection: the `state` parameter is an HMAC-signed nonce+timestamp,
// keyed off the client secret — stateless, so it survives restarts and needs
// no DB table.

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const STATE_TTL_MS = 10 * 60_000;

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Config from env, or null when any piece is missing (feature disabled). */
export function googleAuthConfig(): GoogleAuthConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.API_PUBLIC_URL) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${env.API_PUBLIC_URL.replace(/\/$/, '')}/auth/google/callback`,
  };
}

export function googleAuthEnabled(): boolean {
  return googleAuthConfig() !== null;
}

// ─── CSRF state ──────────────────────────────────────────────────────────────

function signState(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** Opaque CSRF state: `<timestamp>.<nonce>.<hmac>`. */
export function makeState(key: string, now: Date = new Date()): string {
  const payload = `${now.getTime()}.${randomBytes(16).toString('base64url')}`;
  return `${payload}.${signState(payload, key)}`;
}

/** True when `state` was minted by us within the TTL and wasn't tampered with. */
export function verifyState(state: string, key: string, now: Date = new Date()): boolean {
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts as [string, string, string];
  const expected = signState(`${ts}.${nonce}`, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const minted = Number(ts);
  return Number.isFinite(minted) && now.getTime() - minted <= STATE_TTL_MS && minted <= now.getTime();
}

// ─── Flow ────────────────────────────────────────────────────────────────────

/** URL of Google's consent screen for this login attempt. */
export function googleAuthUrl(cfg: GoogleAuthConfig, state: string): string {
  const u = new URL(GOOGLE_AUTH_ENDPOINT);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email');
  u.searchParams.set('state', state);
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

/** Base64url-decode one JWT segment into JSON, or null on any malformation. */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const segment = jwt.split('.')[1];
  if (!segment) return null;
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Exchange the authorization code for tokens and return the user's verified
 * email. Throws with a short, user-safe message on any failure — the caller
 * surfaces it on the login page.
 */
export async function exchangeGoogleCode(
  cfg: GoogleAuthConfig,
  code: string,
  opts: { fetcher?: typeof fetch; now?: Date } = {},
): Promise<{ email: string }> {
  const fetcher = opts.fetcher ?? fetch;
  const now = opts.now ?? new Date();

  const res = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (token exchange HTTP ${res.status})`);

  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error('Google sign-in failed (no id_token in response)');

  const claims = decodeJwtPayload(body.id_token);
  if (!claims) throw new Error('Google sign-in failed (malformed id_token)');

  const iss = claims.iss;
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') {
    throw new Error('Google sign-in failed (unexpected issuer)');
  }
  if (claims.aud !== cfg.clientId) throw new Error('Google sign-in failed (audience mismatch)');
  const exp = typeof claims.exp === 'number' ? claims.exp : 0;
  if (exp * 1000 <= now.getTime()) throw new Error('Google sign-in failed (expired token)');
  const email = typeof claims.email === 'string' ? claims.email : '';
  if (!email || claims.email_verified !== true) {
    throw new Error('Google sign-in failed (no verified email on the account)');
  }
  return { email };
}

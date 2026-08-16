import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Context, MiddlewareHandler, Next } from 'hono';
import { getDb, schema } from '../db/index.js';
import { env } from '../config.js';

/**
 * The pre-auth access gate (GOI-83).
 *
 * The site is closed to the public; access comes from a shared invite link.
 * This is a curtain, not a vault: the threat model is "keep the
 * work-in-progress out of public view and off search engines", explicitly not
 * "protect sensitive data". No accounts, no passwords, no email.
 *
 * Everything lives in this file and one migration, on purpose. When magic-link
 * auth ships, closing this out is deleting a file and flipping a flag — not
 * unpicking invite checks from procedures and components. So nothing here is
 * imported by business code, and nothing in business code knows it exists.
 *
 * DENY BY DEFAULT. The allowlist below is the complete set of paths reachable
 * without a cookie; everything else, including every tRPC procedure, is gated.
 * Gating pages alone would be theatre — an ungated procedure hands over the
 * whole event dataset as JSON no matter what the frontend renders.
 */

export const COOKIE_NAME = 'afisz_invite';
/** A shared link people will come back through; re-exchanging is a papercut. */
const COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
/** 32 bytes as the ticket specifies — random, not derived from anything. */
const TOKEN_BYTES = 32;

/**
 * The only paths reachable without a cookie.
 *
 * `/gate` is not in the ticket's list and is a deliberate addition: the cookie
 * is httpOnly and (in this deployment) set on a different origin from the SPA,
 * so the frontend cannot read it to decide what to render. It answers a single
 * boolean and nothing else. Without it the frontend's only way to know is to
 * fire a real query and read the 401 — which the ticket rules out, and which
 * would leak the app shell in the meantime.
 */
const PUBLIC_PATHS = ['/health', '/gate', '/robots.txt'];
const PUBLIC_PREFIXES = ['/i/'];

// ─── tokens ──────────────────────────────────────────────────────────────────

/** A fresh invite token. Returned once; only its hash is ever stored. */
export function mintToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * A token's shape, checked before it reaches the database.
 *
 * 32 bytes of base64url is 43 characters. Rejecting anything else keeps
 * garbage out of a query, and — more to the point — makes a truncated or
 * mangled token take exactly the same path as a wrong one.
 */
export function looksLikeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * Constant-time compare of two hex digests.
 *
 * Timing analysis is well past this feature's threat model, but the digests
 * are fixed-length and already in hand, so the careful version costs nothing.
 */
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// ─── store ───────────────────────────────────────────────────────────────────

export interface InviteRow {
  tokenHash: string;
  label: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  useCount: number;
}

/**
 * Is this token currently good? One answer for every kind of "no".
 *
 * The caller must not learn *why* a token failed — whether it was revoked,
 * expired, or never existed at all. That's why this returns a boolean rather
 * than a reason, and why the middleware has a single failure response.
 */
export async function isTokenValid(token: string, now: Date = new Date()): Promise<boolean> {
  if (!looksLikeToken(token)) return false;

  const digest = hashToken(token);
  let rows: InviteRow[];
  try {
    rows = (await getDb()
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.tokenHash, digest))
      .limit(1)) as InviteRow[];
  } catch {
    // A gate that fails open on a database blip is not a gate.
    return false;
  }

  const row = rows[0];
  if (!row) return false;
  if (!hashesMatch(row.tokenHash, digest)) return false;
  if (row.revokedAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/** Bump usage stats. Never throws — a failed counter must not deny access. */
export async function recordUse(token: string): Promise<void> {
  try {
    await getDb()
      .update(schema.invites)
      .set({ lastUsedAt: new Date(), useCount: sql`${schema.invites.useCount} + 1` })
      .where(eq(schema.invites.tokenHash, hashToken(token)));
  } catch {
    /* stats only */
  }
}

// ─── cookie ──────────────────────────────────────────────────────────────────

/**
 * The cookie carries the token itself, so every request re-checks it against
 * the table. That is what makes revocation real: a signed "you're fine" cookie
 * would keep working for its full 90 days after the link was revoked, which is
 * the opposite of revoking it.
 */
export function buildCookie(token: string, secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  // SameSite: the ticket says Lax, which is right for a same-origin app. This
  // deployment isn't one — the SPA is on GitHub Pages and the API on Railway,
  // so every API call is cross-site and a Lax cookie would never be sent,
  // locking out the very people who were invited. None+Secure is the only
  // combination that works across origins. Plain-HTTP localhost can't use
  // Secure (browsers drop it), so dev keeps Lax.
  parts.push(secure ? 'SameSite=None' : 'SameSite=Lax');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; ${
    secure ? 'SameSite=None; Secure' : 'SameSite=Lax'
  }`;
}

export function readCookie(header: string | undefined | null): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=') || null;
  }
  return null;
}

/** HTTPS in front of us? Railway terminates TLS and forwards the scheme. */
export function isSecureRequest(c: Context): boolean {
  const proto = c.req.header('x-forwarded-proto');
  if (proto) return proto.split(',')[0]!.trim() === 'https';
  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── middleware ──────────────────────────────────────────────────────────────

/**
 * The one switch that decides whether the site is open.
 *
 * Read from `process.env` at call time rather than from the parsed `env`
 * snapshot, and deliberately without consulting it as a fallback: a snapshot
 * taken at module load is exactly the kind of stale copy you don't want
 * deciding this, and routing the empty case through it would let a value
 * loaded at startup override what the environment says now.
 *
 * `config.ts` still declares and validates the variable — that is where its
 * default is documented, and it applies the same rule.
 *
 * Everything ambiguous fails towards shut. Unset keeps the site closed;
 * `INVITE_GATE_ENABLED=` (how a deploy config often spells "unset") keeps it
 * closed; a typo keeps it closed. Only an explicit "off" opens it.
 */
export function gateEnabled(): boolean {
  const raw = process.env.INVITE_GATE_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === '') return true;
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
}

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Identical for every failure: no token, bad token, expired token, revoked
 * token. Distinguishing them would confirm which links ever existed.
 */
function denied(c: Context) {
  return c.json({ error: 'not available' }, 401);
}

export function inviteGate(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    // Off-switch, and the reason local dev needs no token.
    if (!gateEnabled()) return next();
    // A preflight carries no cookies; answering it 401 breaks the real request
    // before it is ever made.
    if (c.req.method === 'OPTIONS') return next();
    if (isPublicPath(new URL(c.req.url).pathname)) return next();

    const token = readCookie(c.req.header('cookie'));
    if (!token || !(await isTokenValid(token))) return denied(c);

    return next();
  };
}

/**
 * `GET /i/:token` — exchange a link for a cookie, then send the visitor to the
 * app. The token stays valid and reusable: this is a link Angelina shares, not
 * a one-time invite.
 */
export async function exchangeInvite(c: Context): Promise<Response> {
  const token = c.req.param('token') ?? '';
  const secure = isSecureRequest(c);

  if (!(await isTokenValid(token))) {
    // Same page for every reason, and no hint that a token ever existed.
    return c.html(GATE_HTML, 404, { 'X-Robots-Tag': NOINDEX });
  }

  await recordUse(token);
  c.header('Set-Cookie', buildCookie(token, secure));
  c.header('X-Robots-Tag', NOINDEX);
  return c.redirect(env.APP_URL.replace(/\/$/, '') || '/', 302);
}

/** `GET /gate` — "does this browser already hold a working invite?" */
export async function gateStatus(c: Context): Promise<Response> {
  if (!gateEnabled()) return c.json({ open: true });
  const token = readCookie(c.req.header('cookie'));
  return c.json({ open: !!token && (await isTokenValid(token)) });
}

export const NOINDEX = 'noindex, nofollow, noarchive';

/** Disallow everything. Served on every route so a crawler that reaches any
 *  path is told the same thing. */
export const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

/**
 * The "not available" page. Carries no venue names, no event data and no
 * descriptive copy — there is deliberately nothing here worth indexing, and
 * nothing that hints at what the site is.
 */
export const GATE_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${NOINDEX}">
<title>Not available</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f4f1ea; color:#141414;
         font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  p { font-size: 15px; }
</style>
</head><body><p>Not available.</p></body></html>
`;

/**
 * Redact a token out of anything about to be logged.
 *
 * `/i/<token>` in an access log hands the gate to anyone who can read logs,
 * which defeats the point. This app has no request logger today; the helper
 * exists so that adding one can't quietly reintroduce the leak. Note that a
 * platform's own edge logging (Railway's, a CDN's) is outside our reach — the
 * link is shared privately, which is the actual mitigation.
 */
export function redactInvitePath(path: string): string {
  return path.replace(/^\/i\/[^/?#]+/, '/i/[redacted]');
}

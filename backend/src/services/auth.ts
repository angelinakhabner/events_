import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { sendEmail } from './email.js';
import { env } from '../config.js';

// Passwordless auth: the user asks for a login link, we mail a single-use
// token, and verifying it mints a long-lived bearer session. Only SHA-256
// hashes of tokens ever touch the DB, so a leaked dump can't log anyone in.

const MAGIC_LINK_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 90 * 24 * 3_600_000;

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthStore {
  /** Persist a pending magic-link token for `email`. */
  saveToken(tokenHash: string, email: string, expiresAt: Date): Promise<void>;
  /** Atomically consume an unused, unexpired token; returns its email or null. */
  consumeToken(tokenHash: string, now: Date): Promise<string | null>;
  /** Find-or-create the user for a verified email. */
  upsertUser(email: string): Promise<AuthUser>;
  saveSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  /** User for a live session, or null when unknown/expired. */
  userForSession(tokenHash: string, now: Date): Promise<AuthUser | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface MagicLinkResult {
  /** The raw token, exposed so tests (and local dev without Resend) can complete the flow. */
  token: string;
  emailSent: boolean;
}

/**
 * Create a magic-link token for `email` and send the login email. When Resend
 * isn't configured (local dev), the token is still created — the caller can
 * log it — so the flow stays testable end-to-end.
 */
export async function requestMagicLink(
  store: AuthStore,
  emailRaw: string,
  opts: { now?: Date; send?: typeof sendEmail } = {},
): Promise<MagicLinkResult> {
  const email = normalizeEmail(emailRaw);
  const now = opts.now ?? new Date();
  const token = randomBytes(32).toString('base64url');
  await store.saveToken(sha256(token), email, new Date(now.getTime() + MAGIC_LINK_TTL_MS));

  const link = `${env.APP_URL.replace(/\/$/, '')}/auth?token=${token}`;
  let emailSent = false;
  if (env.RESEND_API_KEY) {
    const send = opts.send ?? sendEmail;
    await send({
      to: email,
      subject: 'Your Goin login link',
      html:
        `<p>Click to log in to Goin:</p>` +
        `<p><a href="${link}">${link}</a></p>` +
        `<p>The link is valid for 15 minutes and can be used once. If you didn't request it, ignore this email.</p>`,
    });
    emailSent = true;
  } else {
    console.log(`[auth] RESEND_API_KEY not set — magic link for ${email}: ${link}`);
  }
  return { token, emailSent };
}

export interface VerifyResult {
  sessionToken: string;
  user: AuthUser;
}

/** Exchange a magic-link token for a session. Returns null when invalid/expired/used. */
export async function verifyMagicLink(
  store: AuthStore,
  token: string,
  opts: { now?: Date } = {},
): Promise<VerifyResult | null> {
  const now = opts.now ?? new Date();
  const email = await store.consumeToken(sha256(token), now);
  if (!email) return null;
  const user = await store.upsertUser(email);
  const sessionToken = randomBytes(32).toString('base64url');
  await store.saveSession(sha256(sessionToken), user.id, new Date(now.getTime() + SESSION_TTL_MS));
  return { sessionToken, user };
}

export async function userForSession(
  store: AuthStore,
  sessionToken: string,
  opts: { now?: Date } = {},
): Promise<AuthUser | null> {
  return store.userForSession(sha256(sessionToken), opts.now ?? new Date());
}

export async function logout(store: AuthStore, sessionToken: string): Promise<void> {
  await store.deleteSession(sha256(sessionToken));
}

// ─── In-memory store (tests / no DATABASE_URL) ──────────────────────────────

export class InMemoryAuthStore implements AuthStore {
  private tokens = new Map<string, { email: string; expiresAt: Date; usedAt: Date | null }>();
  private users = new Map<string, AuthUser>(); // by email
  private sessions = new Map<string, { userId: string; expiresAt: Date }>();
  private seq = 0;

  async saveToken(tokenHash: string, email: string, expiresAt: Date): Promise<void> {
    this.tokens.set(tokenHash, { email, expiresAt, usedAt: null });
  }

  async consumeToken(tokenHash: string, now: Date): Promise<string | null> {
    const t = this.tokens.get(tokenHash);
    if (!t || t.usedAt || t.expiresAt.getTime() <= now.getTime()) return null;
    t.usedAt = now;
    return t.email;
  }

  async upsertUser(email: string): Promise<AuthUser> {
    const existing = this.users.get(email);
    if (existing) return existing;
    this.seq += 1;
    const user = { id: `user-${this.seq}`, email };
    this.users.set(email, user);
    return user;
  }

  async saveSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }

  async userForSession(tokenHash: string, now: Date): Promise<AuthUser | null> {
    const s = this.sessions.get(tokenHash);
    if (!s || s.expiresAt.getTime() <= now.getTime()) return null;
    for (const u of this.users.values()) if (u.id === s.userId) return u;
    return null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }
}

// ─── DB store ────────────────────────────────────────────────────────────────

export class DbAuthStore implements AuthStore {
  async saveToken(tokenHash: string, email: string, expiresAt: Date): Promise<void> {
    await getDb().insert(schema.authTokens).values({ tokenHash, email, expiresAt });
  }

  async consumeToken(tokenHash: string, now: Date): Promise<string | null> {
    // Single UPDATE guarded on unused+unexpired makes consumption atomic —
    // two concurrent clicks on the same link can't both mint sessions.
    const rows = await getDb()
      .update(schema.authTokens)
      .set({ usedAt: now })
      .where(and(
        eq(schema.authTokens.tokenHash, tokenHash),
        isNull(schema.authTokens.usedAt),
        gt(schema.authTokens.expiresAt, now),
      ))
      .returning({ email: schema.authTokens.email });
    return rows[0]?.email ?? null;
  }

  async upsertUser(email: string): Promise<AuthUser> {
    const db = getDb();
    const inserted = await db
      .insert(schema.users)
      .values({ email })
      .onConflictDoNothing({ target: schema.users.email })
      .returning();
    if (inserted[0]) return { id: inserted[0].id, email: inserted[0].email };
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (!existing) throw new Error(`User upsert for ${email} found no row`);
    return { id: existing.id, email: existing.email };
  }

  async saveSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    await getDb().insert(schema.sessions).values({ tokenHash, userId, expiresAt });
  }

  async userForSession(tokenHash: string, now: Date): Promise<AuthUser | null> {
    const rows = await getDb()
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(and(eq(schema.sessions.tokenHash, tokenHash), gt(schema.sessions.expiresAt, now)))
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await getDb().delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash));
  }
}

export const defaultAuthStore: AuthStore = process.env.DATABASE_URL
  ? new DbAuthStore()
  : new InMemoryAuthStore();

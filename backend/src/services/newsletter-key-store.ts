import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';

/**
 * Per-newsletter API keys (GOI-152).
 *
 * The key is shown to the reader exactly once, when it is made. Only its
 * SHA-256 is stored: the key is 32 random bytes, so a plain hash (no salt, no
 * slow KDF) is as strong as the key itself and lets a request be looked up by
 * hash in one indexed read.
 */

/** Prefix that makes a leaked key recognisable in logs and secret scanners. */
export const NEWSLETTER_KEY_PREFIX = 'afz_nl_';

/** What the settings screen may know about a key: never the key itself. */
export interface NewsletterKeyView {
  lastFour: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Whose newsletter a presented key opens. */
export interface NewsletterKeyOwner {
  configId: string;
  userId: string;
}

export interface NewsletterKeyStore {
  view(userId: string, configId: string): Promise<NewsletterKeyView | null>;
  /** Make a key, replacing any the newsletter had. Returns the key in full —
   *  the only time it is ever available. */
  issue(userId: string, configId: string): Promise<{ key: string; view: NewsletterKeyView }>;
  /** False when the newsletter had no key. */
  revoke(userId: string, configId: string): Promise<boolean>;
  /** The newsletter a key opens, or null. Stamps `lastUsedAt` on a match. */
  resolve(key: string, now?: Date): Promise<NewsletterKeyOwner | null>;
}

export function hashNewsletterKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateNewsletterKey(): string {
  return NEWSLETTER_KEY_PREFIX + randomBytes(32).toString('base64url');
}

type Row = typeof schema.newsletterApiKeys.$inferSelect;

function toView(row: Pick<Row, 'lastFour' | 'createdAt' | 'lastUsedAt'>): NewsletterKeyView {
  return {
    lastFour: row.lastFour,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

class DbNewsletterKeyStore implements NewsletterKeyStore {
  async view(userId: string, configId: string) {
    const [row] = await getDb()
      .select()
      .from(schema.newsletterApiKeys)
      .where(and(eq(schema.newsletterApiKeys.userId, userId), eq(schema.newsletterApiKeys.configId, configId)));
    return row ? toView(row) : null;
  }

  async issue(userId: string, configId: string) {
    const key = generateNewsletterKey();
    const values = {
      configId,
      userId,
      keyHash: hashNewsletterKey(key),
      lastFour: key.slice(-4),
      createdAt: new Date(),
      lastUsedAt: null,
    };
    const [row] = await getDb()
      .insert(schema.newsletterApiKeys)
      .values(values)
      .onConflictDoUpdate({
        target: schema.newsletterApiKeys.configId,
        set: { keyHash: values.keyHash, lastFour: values.lastFour, createdAt: values.createdAt, lastUsedAt: null },
      })
      .returning();
    return { key, view: toView(row!) };
  }

  async revoke(userId: string, configId: string) {
    const rows = await getDb()
      .delete(schema.newsletterApiKeys)
      .where(and(eq(schema.newsletterApiKeys.userId, userId), eq(schema.newsletterApiKeys.configId, configId)))
      .returning({ configId: schema.newsletterApiKeys.configId });
    return rows.length > 0;
  }

  async resolve(key: string, now = new Date()) {
    const [row] = await getDb()
      .update(schema.newsletterApiKeys)
      .set({ lastUsedAt: now })
      .where(eq(schema.newsletterApiKeys.keyHash, hashNewsletterKey(key)))
      .returning({ configId: schema.newsletterApiKeys.configId, userId: schema.newsletterApiKeys.userId });
    return row ?? null;
  }
}

/**
 * In memory, for tests. Kept beside the real store so both are held to the
 * same interface.
 */
export class MemoryNewsletterKeyStore implements NewsletterKeyStore {
  private rows = new Map<string, Row>();

  async view(userId: string, configId: string) {
    const row = this.rows.get(configId);
    return row && row.userId === userId ? toView(row) : null;
  }

  async issue(userId: string, configId: string) {
    const key = generateNewsletterKey();
    const row: Row = {
      configId, userId, keyHash: hashNewsletterKey(key), lastFour: key.slice(-4),
      createdAt: new Date(), lastUsedAt: null,
    };
    this.rows.set(configId, row);
    return { key, view: toView(row) };
  }

  async revoke(userId: string, configId: string) {
    const row = this.rows.get(configId);
    if (!row || row.userId !== userId) return false;
    return this.rows.delete(configId);
  }

  async resolve(key: string, now = new Date()) {
    const hash = hashNewsletterKey(key);
    for (const row of this.rows.values()) {
      if (row.keyHash === hash) {
        row.lastUsedAt = now;
        return { configId: row.configId, userId: row.userId };
      }
    }
    return null;
  }
}

export const defaultNewsletterKeyStore: NewsletterKeyStore = new DbNewsletterKeyStore();

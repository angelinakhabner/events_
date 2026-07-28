import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NewsletterCategoryRule, NewsletterFrequency, NewsletterSettings } from '@goin/shared';
import { getDb, schema } from '../db/index.js';

// Newsletter subscriptions (GOI-8): one per user. The user picks an email,
// a cadence (daily/weekly), which venues the brief covers and an optional
// time window ("everything after 6 pm").

export interface NewsletterSaveInput {
  email: string;
  recipientName?: string | null;
  frequency: NewsletterFrequency;
  venueIds: string[];
  afterHour?: number | null;
  beforeHour?: number | null;
  sendHour?: number;
  sendMinute?: number;
  sendWeekday?: number;
  categoryRules?: NewsletterCategoryRule[];
  enabled: boolean;
}

export interface NewsletterSubscription extends NewsletterSettings {
  userId: string;
  /** Secret behind this subscription's one-click unsubscribe link (GOI-35).
   *  Stays server-side: the sender needs it to build the link, the SPA doesn't. */
  unsubscribeToken: string;
}

/** What an unsubscribe attempt did, so the landing page can word itself. */
export type UnsubscribeResult =
  | { status: 'unsubscribed'; email: string }
  /** Valid token, but the subscription was already off — clicking the link in
   *  an older brief a second time must not read as an error. */
  | { status: 'already'; email: string }
  | { status: 'unknown' };

export interface NewsletterStore {
  get(userId: string): Promise<NewsletterSettings | null>;
  save(userId: string, input: NewsletterSaveInput): Promise<NewsletterSettings>;
  /** Enabled subscriptions — the sender's work list. */
  listEnabled(): Promise<NewsletterSubscription[]>;
  markSent(userId: string, at: Date): Promise<void>;
  /** Turn a subscription off by its unsubscribe token — no session required. */
  unsubscribeByToken(token: string): Promise<UnsubscribeResult>;
}

/** 256 bits, URL-safe — it travels in a query string and an email header. */
function newUnsubscribeToken(): string {
  return randomBytes(32).toString('base64url');
}

type Row = typeof schema.newsletterSubscriptions.$inferSelect;

function toSettings(row: Row): NewsletterSettings {
  return {
    email: row.email,
    recipientName: row.recipientName,
    frequency: row.frequency as NewsletterFrequency,
    venueIds: row.venueIds,
    afterHour: row.afterHour,
    beforeHour: row.beforeHour,
    sendHour: row.sendHour,
    sendMinute: row.sendMinute,
    sendWeekday: row.sendWeekday,
    categoryRules: row.categoryRules as NewsletterCategoryRule[],
    enabled: row.enabled,
    lastSentAt: row.lastSentAt ? row.lastSentAt.toISOString() : null,
  };
}

/** Fill the schedule/scope fields a caller left out with their defaults. */
function withScheduleDefaults(input: NewsletterSaveInput) {
  return {
    sendHour: input.sendHour ?? 8,
    sendMinute: input.sendMinute ?? 0,
    sendWeekday: input.sendWeekday ?? 1,
    categoryRules: input.categoryRules ?? [],
  };
}

export class DbNewsletterStore implements NewsletterStore {
  async get(userId: string): Promise<NewsletterSettings | null> {
    const [row] = await getDb()
      .select()
      .from(schema.newsletterSubscriptions)
      .where(eq(schema.newsletterSubscriptions.userId, userId))
      .limit(1);
    return row ? toSettings(row) : null;
  }

  async save(userId: string, input: NewsletterSaveInput): Promise<NewsletterSettings> {
    const set = {
      email: input.email.trim(),
      recipientName: input.recipientName?.trim() || null,
      frequency: input.frequency,
      venueIds: input.venueIds,
      afterHour: input.afterHour ?? null,
      beforeHour: input.beforeHour ?? null,
      ...withScheduleDefaults(input),
      enabled: input.enabled,
      updatedAt: new Date(),
    };
    const [row] = await getDb()
      .insert(schema.newsletterSubscriptions)
      // The token is insert-only: editing settings must not invalidate the
      // unsubscribe links in briefs already sitting in the reader's inbox.
      .values({ userId, ...set, unsubscribeToken: newUnsubscribeToken() })
      .onConflictDoUpdate({ target: schema.newsletterSubscriptions.userId, set })
      .returning();
    return toSettings(row!);
  }

  async listEnabled(): Promise<NewsletterSubscription[]> {
    const rows = await getDb()
      .select()
      .from(schema.newsletterSubscriptions)
      .where(eq(schema.newsletterSubscriptions.enabled, true));
    return rows.map((r) => ({
      userId: r.userId,
      unsubscribeToken: r.unsubscribeToken,
      ...toSettings(r),
    }));
  }

  async markSent(userId: string, at: Date): Promise<void> {
    await getDb()
      .update(schema.newsletterSubscriptions)
      .set({ lastSentAt: at })
      .where(eq(schema.newsletterSubscriptions.userId, userId));
  }

  async unsubscribeByToken(token: string): Promise<UnsubscribeResult> {
    // An empty token would otherwise match a row in any database where the
    // backfill has not run, so refuse it before touching the table.
    if (!token) return { status: 'unknown' };
    const [row] = await getDb()
      .select({
        email: schema.newsletterSubscriptions.email,
        enabled: schema.newsletterSubscriptions.enabled,
      })
      .from(schema.newsletterSubscriptions)
      .where(eq(schema.newsletterSubscriptions.unsubscribeToken, token))
      .limit(1);
    if (!row) return { status: 'unknown' };
    if (!row.enabled) return { status: 'already', email: row.email };

    await getDb()
      .update(schema.newsletterSubscriptions)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(schema.newsletterSubscriptions.unsubscribeToken, token));
    return { status: 'unsubscribed', email: row.email };
  }
}

function stripUserId(sub: NewsletterSubscription): NewsletterSettings {
  return {
    email: sub.email,
    recipientName: sub.recipientName,
    frequency: sub.frequency,
    venueIds: sub.venueIds,
    afterHour: sub.afterHour,
    beforeHour: sub.beforeHour,
    sendHour: sub.sendHour,
    sendMinute: sub.sendMinute,
    sendWeekday: sub.sendWeekday,
    categoryRules: sub.categoryRules,
    enabled: sub.enabled,
    lastSentAt: sub.lastSentAt,
  };
}

// In-memory variant for tests / no DATABASE_URL.
export class InMemoryNewsletterStore implements NewsletterStore {
  private byUser = new Map<string, NewsletterSubscription>();

  async get(userId: string): Promise<NewsletterSettings | null> {
    const sub = this.byUser.get(userId);
    return sub ? stripUserId(sub) : null;
  }

  async save(userId: string, input: NewsletterSaveInput): Promise<NewsletterSettings> {
    const prev = this.byUser.get(userId);
    const sub: NewsletterSubscription = {
      userId,
      email: input.email.trim(),
      recipientName: input.recipientName?.trim() || null,
      frequency: input.frequency,
      venueIds: [...input.venueIds],
      afterHour: input.afterHour ?? null,
      beforeHour: input.beforeHour ?? null,
      ...withScheduleDefaults(input),
      enabled: input.enabled,
      // Mirrors the DB store: kept across edits so links already in an inbox
      // keep working.
      unsubscribeToken: prev?.unsubscribeToken ?? newUnsubscribeToken(),
      lastSentAt: prev?.lastSentAt ?? null,
    };
    this.byUser.set(userId, sub);
    return stripUserId(sub);
  }

  async listEnabled(): Promise<NewsletterSubscription[]> {
    return [...this.byUser.values()].filter((s) => s.enabled).map((s) => ({ ...s }));
  }

  async markSent(userId: string, at: Date): Promise<void> {
    const sub = this.byUser.get(userId);
    if (sub) sub.lastSentAt = at.toISOString();
  }

  async unsubscribeByToken(token: string): Promise<UnsubscribeResult> {
    if (!token) return { status: 'unknown' };
    const sub = [...this.byUser.values()].find((s) => s.unsubscribeToken === token);
    if (!sub) return { status: 'unknown' };
    if (!sub.enabled) return { status: 'already', email: sub.email };
    sub.enabled = false;
    return { status: 'unsubscribed', email: sub.email };
  }
}

export const defaultNewsletterStore: NewsletterStore = process.env.DATABASE_URL
  ? new DbNewsletterStore()
  : new InMemoryNewsletterStore();

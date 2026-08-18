import { eq } from 'drizzle-orm';
import type { NewsletterCategoryRule, NewsletterFrequency, NewsletterSettings } from '@afisz/shared';
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
}

export interface NewsletterStore {
  get(userId: string): Promise<NewsletterSettings | null>;
  save(userId: string, input: NewsletterSaveInput): Promise<NewsletterSettings>;
  /** Enabled subscriptions — the sender's work list. */
  listEnabled(): Promise<NewsletterSubscription[]>;
  markSent(userId: string, at: Date): Promise<void>;
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
    const values = {
      userId,
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
      .values(values)
      .onConflictDoUpdate({ target: schema.newsletterSubscriptions.userId, set: values })
      .returning();
    return toSettings(row!);
  }

  async listEnabled(): Promise<NewsletterSubscription[]> {
    const rows = await getDb()
      .select()
      .from(schema.newsletterSubscriptions)
      .where(eq(schema.newsletterSubscriptions.enabled, true));
    return rows.map((r) => ({ userId: r.userId, ...toSettings(r) }));
  }

  async markSent(userId: string, at: Date): Promise<void> {
    await getDb()
      .update(schema.newsletterSubscriptions)
      .set({ lastSentAt: at })
      .where(eq(schema.newsletterSubscriptions.userId, userId));
  }
}

/** A subscription as callers outside this process may see it. The internal
 *  user id is session-adjacent and never leaves the backend — the public API
 *  (GOI-87) addresses subscriptions by email instead. */
export function stripUserId(sub: NewsletterSubscription): NewsletterSettings {
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
}

export const defaultNewsletterStore: NewsletterStore = process.env.DATABASE_URL
  ? new DbNewsletterStore()
  : new InMemoryNewsletterStore();

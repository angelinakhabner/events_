import { eq } from 'drizzle-orm';
import type { NewsletterEventDayMode, NewsletterFrequency, NewsletterSettings } from '@goin/shared';
import { getDb, schema } from '../db/index.js';

// Newsletter subscriptions (GOI-8): one per user. The user picks an email,
// a cadence (daily/weekly), which venues the brief covers and an optional
// time window ("everything after 6 pm").

export interface NewsletterSaveInput {
  email: string;
  frequency: NewsletterFrequency;
  venueIds: string[];
  afterHour?: number | null;
  beforeHour?: number | null;
  sendHour?: number;
  sendWeekday?: number;
  eventDayMode?: NewsletterEventDayMode;
  eventDay?: number | null;
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
    frequency: row.frequency as NewsletterFrequency,
    venueIds: row.venueIds,
    afterHour: row.afterHour,
    beforeHour: row.beforeHour,
    sendHour: row.sendHour,
    sendWeekday: row.sendWeekday,
    eventDayMode: row.eventDayMode as NewsletterEventDayMode,
    eventDay: row.eventDay,
    enabled: row.enabled,
    lastSentAt: row.lastSentAt ? row.lastSentAt.toISOString() : null,
  };
}

/** Fill the schedule/scope fields a caller left out with their defaults, and
 *  keep `eventDay` consistent with the mode it belongs to. */
function withScheduleDefaults(input: NewsletterSaveInput) {
  const eventDayMode = input.eventDayMode ?? 'all';
  return {
    sendHour: input.sendHour ?? 8,
    sendWeekday: input.sendWeekday ?? 1,
    eventDayMode,
    eventDay: eventDayMode === 'specific' ? input.eventDay ?? null : null,
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

function stripUserId(sub: NewsletterSubscription): NewsletterSettings {
  return {
    email: sub.email,
    frequency: sub.frequency,
    venueIds: sub.venueIds,
    afterHour: sub.afterHour,
    beforeHour: sub.beforeHour,
    sendHour: sub.sendHour,
    sendWeekday: sub.sendWeekday,
    eventDayMode: sub.eventDayMode,
    eventDay: sub.eventDay,
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

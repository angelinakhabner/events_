import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import type {
  EventChangeType, NewsletterCategoryRule, NewsletterDetail, NewsletterRuleCadence,
  NewsletterSendCadence, NewsletterSettings, NewsletterTimeFilter, NewsletterWantToGo,
} from '@afisz/shared';
import { DEFAULT_WANT_TO_GO } from '@afisz/shared';
import { getDb, schema } from '../db/index.js';

/**
 * Newsletter configs (GOI-8, reshaped by GOI-100).
 *
 * One config per folder rather than one per user: the venues a newsletter
 * covers are a folder's venues, and a reader has more than one folder. A
 * config with a null `folderId` is the pre-folder subscription, which covers
 * everything the reader follows — there is at most one of those per user, and
 * the store addresses it as the default.
 */

export interface NewsletterSaveInput {
  email: string;
  recipientName?: string | null;
  /** Which folder's venues; null keeps the folderless default config. */
  folderId?: string | null;
  name?: string;
  sendCadence: NewsletterSendCadence;
  venueIds: string[];
  beforeHour?: number | null;
  sendHour?: number;
  sendMinute?: number;
  sendWeekday?: number | null;
  sendDayOfMonth?: number | null;
  timezone?: string;
  suppressEmptyIssues?: boolean;
  wantToGo?: NewsletterWantToGo;
  categoryRules?: NewsletterCategoryRule[];
  enabled: boolean;
}

export interface NewsletterSubscription extends NewsletterSettings {
  userId: string;
}

export interface NewsletterStore {
  /** The reader's config for a folder, or the folderless default. */
  get(userId: string, folderId?: string | null): Promise<NewsletterSettings | null>;
  /** Every config the reader holds. */
  list(userId: string): Promise<NewsletterSettings[]>;
  save(userId: string, input: NewsletterSaveInput): Promise<NewsletterSettings>;
  /** Enabled configs — the sender's work list. */
  listEnabled(): Promise<NewsletterSubscription[]>;
  markSent(configId: string, at: Date): Promise<void>;
  /** Stamps an off-schedule change email, which is rate-limited separately
   *  from the scheduled issue (GOI-101). */
  markUrgentSent(configId: string, at: Date): Promise<void>;
  /** When the last off-schedule email went out, for that rate limit. */
  lastUrgentAt(configId: string): Promise<string | null>;

  // ── Send state (GOI-100) ──────────────────────────────────────────────────
  /** Which of `eventIds` have already been sent for this config in `state`. */
  sentStates(configId: string, state: string, eventIds: string[]): Promise<Set<string>>;
  /** Record a send. Idempotent — a concurrent attempt must not raise. */
  recordSent(configId: string, state: string, eventIds: string[], at: Date): Promise<void>;
  /** Retention: drop send state older than `before`. */
  pruneSentEvents(before: Date): Promise<number>;

  /** Changes noticed to any of `eventIds` since `since` (GOI-101), oldest
   *  first — a rescheduled-then-cancelled event reports both. */
  changesFor(eventIds: string[], since: Date): Promise<EventChangeRow[]>;
}

/** One row of `event_changes`, as the queue reads it. */
export interface EventChangeRow {
  eventId: string;
  changeType: EventChangeType;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
}

/** Send state older than this is no longer telling anyone anything — the
 *  events it refers to are months past. Dropped by the cleanup job. */
export const SENT_EVENT_RETENTION_DAYS = 120;

type Row = typeof schema.newsletterSubscriptions.$inferSelect;
type RuleRow = typeof schema.newsletterCategoryRules.$inferSelect;

function toRule(row: RuleRow): NewsletterCategoryRule {
  return {
    category: row.category,
    cadence: row.cadence as NewsletterRuleCadence,
    cadenceWeekday: row.cadenceWeekday,
    detail: row.depth as NewsletterDetail,
    timeFilter: row.timeFilter as NewsletterTimeFilter,
    lookaheadDays: row.lookaheadDays,
    sortOrder: row.sortOrder,
  };
}

function toSettings(row: Row, rules: NewsletterCategoryRule[]): NewsletterSettings {
  return {
    id: row.id,
    folderId: row.folderId,
    name: row.name,
    email: row.email,
    recipientName: row.recipientName,
    sendCadence: row.sendCadence as NewsletterSendCadence,
    sendWeekday: row.sendWeekday,
    sendDayOfMonth: row.sendDayOfMonth,
    sendHour: row.sendHour,
    sendMinute: row.sendMinute,
    timezone: row.timezone,
    venueIds: row.venueIds,
    beforeHour: row.beforeHour,
    suppressEmptyIssues: row.suppressEmptyIssues,
    wantToGo: { ...DEFAULT_WANT_TO_GO, ...(row.wantToGo ?? {}) },
    categoryRules: [...rules].sort((a, b) => a.sortOrder - b.sortOrder),
    enabled: row.enabled,
    lastSentAt: row.lastSentAt ? row.lastSentAt.toISOString() : null,
  };
}

/**
 * Fill in what a caller left out, and — the part that matters — null the
 * fields that do not apply to the chosen cadence.
 *
 * `send_weekday` on a monthly newsletter is not harmless: it is a number a
 * later reader will believe means something. The same goes for a rule's
 * `cadenceWeekday` outside the one combination where it decides anything.
 */
function normalise(input: NewsletterSaveInput) {
  const sendCadence = input.sendCadence;
  return {
    name: input.name?.trim() || 'Newsletter',
    folderId: input.folderId ?? null,
    sendHour: input.sendHour ?? 8,
    sendMinute: input.sendMinute ?? 0,
    sendWeekday: sendCadence === 'weekly' ? (input.sendWeekday ?? 1) : null,
    sendDayOfMonth: sendCadence === 'monthly' ? (input.sendDayOfMonth ?? 1) : null,
    timezone: input.timezone ?? 'Europe/Warsaw',
    suppressEmptyIssues: input.suppressEmptyIssues ?? true,
    wantToGo: { ...DEFAULT_WANT_TO_GO, ...(input.wantToGo ?? {}) },
    categoryRules: normaliseRules(input.categoryRules ?? [], sendCadence),
  };
}

/** A rule's weekday only decides something in one combination; everywhere
 *  else it is stored as null rather than as a value that does nothing. */
export function normaliseRules(
  rules: NewsletterCategoryRule[],
  sendCadence: NewsletterSendCadence,
): NewsletterCategoryRule[] {
  return rules.map((r, i) => ({
    ...r,
    cadenceWeekday:
      sendCadence === 'daily' && r.cadence === 'weekly' ? (r.cadenceWeekday ?? 1) : null,
    sortOrder: r.sortOrder ?? i,
  }));
}

export class DbNewsletterStore implements NewsletterStore {
  async get(userId: string, folderId: string | null = null): Promise<NewsletterSettings | null> {
    const [row] = await getDb()
      .select()
      .from(schema.newsletterSubscriptions)
      .where(
        and(
          eq(schema.newsletterSubscriptions.userId, userId),
          folderId === null
            ? isNull(schema.newsletterSubscriptions.folderId)
            : eq(schema.newsletterSubscriptions.folderId, folderId),
        ),
      )
      .limit(1);
    if (!row) return null;
    return toSettings(row, await this.rulesFor(row.id));
  }

  async list(userId: string): Promise<NewsletterSettings[]> {
    const rows = await getDb()
      .select()
      .from(schema.newsletterSubscriptions)
      .where(eq(schema.newsletterSubscriptions.userId, userId));
    return Promise.all(rows.map(async (r) => toSettings(r, await this.rulesFor(r.id))));
  }

  private async rulesFor(configId: string): Promise<NewsletterCategoryRule[]> {
    const rows = await getDb()
      .select()
      .from(schema.newsletterCategoryRules)
      .where(eq(schema.newsletterCategoryRules.configId, configId));
    return rows.map(toRule);
  }

  async save(userId: string, input: NewsletterSaveInput): Promise<NewsletterSettings> {
    const norm = normalise(input);
    const values = {
      userId,
      folderId: norm.folderId,
      name: norm.name,
      email: input.email.trim(),
      recipientName: input.recipientName?.trim() || null,
      sendCadence: input.sendCadence,
      venueIds: input.venueIds,
      beforeHour: input.beforeHour ?? null,
      sendHour: norm.sendHour,
      sendMinute: norm.sendMinute,
      sendWeekday: norm.sendWeekday,
      sendDayOfMonth: norm.sendDayOfMonth,
      timezone: norm.timezone,
      suppressEmptyIssues: norm.suppressEmptyIssues,
      wantToGo: norm.wantToGo,
      enabled: input.enabled,
      updatedAt: new Date(),
    };

    const existing = await this.get(userId, norm.folderId);
    const db = getDb();
    let configId: string;
    if (existing) {
      await db
        .update(schema.newsletterSubscriptions)
        .set(values)
        .where(eq(schema.newsletterSubscriptions.id, existing.id));
      configId = existing.id;
    } else {
      const [row] = await db.insert(schema.newsletterSubscriptions).values(values).returning();
      configId = row!.id;
    }

    // The rules are replaced wholesale. They are a small ordered set the
    // settings screen always submits complete, so diffing them would be work
    // done to arrive at the same rows.
    await db
      .delete(schema.newsletterCategoryRules)
      .where(eq(schema.newsletterCategoryRules.configId, configId));
    if (norm.categoryRules.length > 0) {
      await db.insert(schema.newsletterCategoryRules).values(
        norm.categoryRules.map((r) => ({
          configId,
          category: r.category,
          cadence: r.cadence,
          cadenceWeekday: r.cadenceWeekday,
          depth: r.detail,
          timeFilter: r.timeFilter,
          lookaheadDays: r.lookaheadDays,
          sortOrder: r.sortOrder,
        })),
      );
    }

    const saved = await this.get(userId, norm.folderId);
    return saved!;
  }

  async listEnabled(): Promise<NewsletterSubscription[]> {
    const rows = await getDb()
      .select()
      .from(schema.newsletterSubscriptions)
      .where(eq(schema.newsletterSubscriptions.enabled, true));
    return Promise.all(
      rows.map(async (r) => ({ userId: r.userId, ...toSettings(r, await this.rulesFor(r.id)) })),
    );
  }

  async markSent(configId: string, at: Date): Promise<void> {
    await getDb()
      .update(schema.newsletterSubscriptions)
      .set({ lastSentAt: at })
      .where(eq(schema.newsletterSubscriptions.id, configId));
  }

  async markUrgentSent(configId: string, at: Date): Promise<void> {
    await getDb()
      .update(schema.newsletterSubscriptions)
      .set({ lastUrgentAt: at })
      .where(eq(schema.newsletterSubscriptions.id, configId));
  }

  async lastUrgentAt(configId: string): Promise<string | null> {
    const [row] = await getDb()
      .select({ at: schema.newsletterSubscriptions.lastUrgentAt })
      .from(schema.newsletterSubscriptions)
      .where(eq(schema.newsletterSubscriptions.id, configId))
      .limit(1);
    return row?.at ? row.at.toISOString() : null;
  }

  async sentStates(configId: string, state: string, eventIds: string[]): Promise<Set<string>> {
    if (eventIds.length === 0) return new Set();
    const rows = await getDb()
      .select({ eventId: schema.newsletterSentEvents.eventId })
      .from(schema.newsletterSentEvents)
      .where(
        and(
          eq(schema.newsletterSentEvents.configId, configId),
          eq(schema.newsletterSentEvents.state, state),
        ),
      );
    const seen = new Set(rows.map((r) => r.eventId));
    return new Set(eventIds.filter((id) => seen.has(id)));
  }

  async recordSent(configId: string, state: string, eventIds: string[], at: Date): Promise<void> {
    if (eventIds.length === 0) return;
    await getDb()
      .insert(schema.newsletterSentEvents)
      .values(eventIds.map((eventId) => ({ configId, eventId, state, sentAt: at })))
      // Two sweeps racing must not fail the send; the row already saying what
      // this one was about to say is the outcome either way.
      .onConflictDoNothing();
  }

  async pruneSentEvents(before: Date): Promise<number> {
    const rows = await getDb()
      .delete(schema.newsletterSentEvents)
      .where(lt(schema.newsletterSentEvents.sentAt, before))
      .returning({ eventId: schema.newsletterSentEvents.eventId });
    return rows.length;
  }

  async changesFor(eventIds: string[], since: Date): Promise<EventChangeRow[]> {
    if (eventIds.length === 0) return [];
    const rows = await getDb()
      .select()
      .from(schema.eventChanges)
      .where(
        and(
          inArray(schema.eventChanges.eventId, eventIds),
          gte(schema.eventChanges.detectedAt, since),
        ),
      )
      .orderBy(schema.eventChanges.detectedAt);
    return rows.map((r) => ({
      eventId: r.eventId,
      changeType: r.changeType as EventChangeType,
      oldValue: r.oldValue,
      newValue: r.newValue,
      detectedAt: r.detectedAt.toISOString(),
    }));
  }
}

/** A config as callers outside this process may see it. The internal user id
 *  is session-adjacent and never leaves the backend — the public API (GOI-87)
 *  addresses configs by email instead. */
export function stripUserId(sub: NewsletterSubscription): NewsletterSettings {
  const copy: Partial<NewsletterSubscription> = { ...sub };
  delete copy.userId;
  return copy as NewsletterSettings;
}

// In-memory variant for tests / no DATABASE_URL.
export class InMemoryNewsletterStore implements NewsletterStore {
  private configs: NewsletterSubscription[] = [];
  private urgentAt = new Map<string, string>();
  private sent = new Map<string, Date>();
  private nextId = 1;

  private find(userId: string, folderId: string | null) {
    return this.configs.find((c) => c.userId === userId && (c.folderId ?? null) === folderId);
  }

  async get(userId: string, folderId: string | null = null): Promise<NewsletterSettings | null> {
    const sub = this.find(userId, folderId);
    return sub ? stripUserId(structuredClone(sub)) : null;
  }

  async list(userId: string): Promise<NewsletterSettings[]> {
    return this.configs
      .filter((c) => c.userId === userId)
      .map((c) => stripUserId(structuredClone(c)));
  }

  async save(userId: string, input: NewsletterSaveInput): Promise<NewsletterSettings> {
    const norm = normalise(input);
    const prev = this.find(userId, norm.folderId);
    const sub: NewsletterSubscription = {
      userId,
      id: prev?.id ?? `nl-${this.nextId++}`,
      folderId: norm.folderId,
      name: norm.name,
      email: input.email.trim(),
      recipientName: input.recipientName?.trim() || null,
      sendCadence: input.sendCadence,
      sendWeekday: norm.sendWeekday,
      sendDayOfMonth: norm.sendDayOfMonth,
      sendHour: norm.sendHour,
      sendMinute: norm.sendMinute,
      timezone: norm.timezone,
      venueIds: [...input.venueIds],
      beforeHour: input.beforeHour ?? null,
      suppressEmptyIssues: norm.suppressEmptyIssues,
      wantToGo: norm.wantToGo,
      categoryRules: norm.categoryRules,
      enabled: input.enabled,
      lastSentAt: prev?.lastSentAt ?? null,
    };
    if (prev) this.configs[this.configs.indexOf(prev)] = sub;
    else this.configs.push(sub);
    return stripUserId(structuredClone(sub));
  }

  async listEnabled(): Promise<NewsletterSubscription[]> {
    return this.configs.filter((s) => s.enabled).map((s) => structuredClone(s));
  }

  async markSent(configId: string, at: Date): Promise<void> {
    const sub = this.configs.find((c) => c.id === configId);
    if (sub) sub.lastSentAt = at.toISOString();
  }

  async markUrgentSent(configId: string, at: Date): Promise<void> {
    this.urgentAt.set(configId, at.toISOString());
  }

  async lastUrgentAt(configId: string): Promise<string | null> {
    return this.urgentAt.get(configId) ?? null;
  }

  private key(configId: string, state: string, eventId: string): string {
    return `${configId} ${state} ${eventId}`;
  }

  async sentStates(configId: string, state: string, eventIds: string[]): Promise<Set<string>> {
    return new Set(eventIds.filter((id) => this.sent.has(this.key(configId, state, id))));
  }

  async recordSent(configId: string, state: string, eventIds: string[], at: Date): Promise<void> {
    for (const id of eventIds) {
      const key = this.key(configId, state, id);
      if (!this.sent.has(key)) this.sent.set(key, at);
    }
  }

  async pruneSentEvents(before: Date): Promise<number> {
    let dropped = 0;
    for (const [key, at] of [...this.sent]) {
      if (at < before) {
        this.sent.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  /** Seeded by tests; the DB store reads `event_changes`. */
  changes: EventChangeRow[] = [];

  async changesFor(eventIds: string[], since: Date): Promise<EventChangeRow[]> {
    return this.changes
      .filter((c) => eventIds.includes(c.eventId) && new Date(c.detectedAt) >= since)
      .sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
  }
}

export const defaultNewsletterStore: NewsletterStore = process.env.DATABASE_URL
  ? new DbNewsletterStore()
  : new InMemoryNewsletterStore();

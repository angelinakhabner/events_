import { eq } from 'drizzle-orm';
import { DEFAULT_SHARE_TEMPLATE, type UserSettings } from '@afisz/shared';
import { getDb, schema } from '../db/index.js';

/**
 * A logged-in user's own preferences (GOI-49).
 *
 * A missing row means "all defaults", so `get` never returns null and nothing
 * needs backfilling for existing accounts. Saving the default wording back
 * clears the override rather than storing a copy of it — otherwise a user who
 * never really customised anything would be pinned to today's phrasing
 * forever.
 */
export interface SettingsStore {
  get(userId: string): Promise<UserSettings>;
  save(userId: string, settings: UserSettings): Promise<UserSettings>;
}

/** Trim, and treat "same as the default" and "blank" alike as no override. */
function normaliseShareText(shareText: string): string | null {
  const trimmed = shareText.trim();
  return trimmed === '' || trimmed === DEFAULT_SHARE_TEMPLATE ? null : trimmed;
}

export class DbSettingsStore implements SettingsStore {
  async get(userId: string): Promise<UserSettings> {
    const [row] = await getDb()
      .select({ shareText: schema.userSettings.shareText })
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId));
    return { shareText: row?.shareText ?? DEFAULT_SHARE_TEMPLATE };
  }

  async save(userId: string, settings: UserSettings): Promise<UserSettings> {
    const shareText = normaliseShareText(settings.shareText);
    await getDb()
      .insert(schema.userSettings)
      .values({ userId, shareText })
      .onConflictDoUpdate({
        target: schema.userSettings.userId,
        set: { shareText, updatedAt: new Date() },
      });
    return { shareText: shareText ?? DEFAULT_SHARE_TEMPLATE };
  }
}

/** In-memory variant for tests / no DATABASE_URL. */
export class InMemorySettingsStore implements SettingsStore {
  private byUser = new Map<string, string | null>();

  async get(userId: string): Promise<UserSettings> {
    return { shareText: this.byUser.get(userId) ?? DEFAULT_SHARE_TEMPLATE };
  }

  async save(userId: string, settings: UserSettings): Promise<UserSettings> {
    const shareText = normaliseShareText(settings.shareText);
    this.byUser.set(userId, shareText);
    return { shareText: shareText ?? DEFAULT_SHARE_TEMPLATE };
  }
}

export const defaultSettingsStore: SettingsStore = process.env.DATABASE_URL
  ? new DbSettingsStore()
  : new InMemorySettingsStore();

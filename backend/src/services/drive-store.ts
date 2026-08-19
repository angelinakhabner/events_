import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import {
  DEFAULT_DRIVE_FOLDER,
  type DriveConnectionView,
  type DriveProviderId,
} from './cloud-drive.js';

/**
 * Storage for drive connections (GOI-91).
 *
 * Two read shapes on purpose. `view()` is what the router hands the browser
 * and carries no refresh token; `credentials()` is the backend-only read that
 * does. Separating them at the store means a procedure cannot leak the token by
 * returning "the connection" — there is no single object holding both.
 */

export interface DriveCredentials {
  userId: string;
  provider: DriveProviderId;
  refreshToken: string;
  folderName: string;
  folderId: string | null;
}

export interface DriveConnectInput {
  provider: DriveProviderId;
  refreshToken: string;
  accountEmail: string | null;
  folderName?: string;
}

export interface DriveStore {
  /** Safe to return to the browser: no refresh token. */
  view(userId: string): Promise<DriveConnectionView[]>;
  /** Backend-only. Every enabled connection, for the sweep. */
  credentials(userId: string, provider: DriveProviderId): Promise<DriveCredentials | null>;
  connect(userId: string, input: DriveConnectInput): Promise<DriveConnectionView>;
  disconnect(userId: string, provider: DriveProviderId): Promise<void>;
  /** Remember the folder so the next upload skips the search. */
  rememberFolder(userId: string, provider: DriveProviderId, folderId: string): Promise<void>;
  /** Record the outcome of an upload attempt; success clears `lastError`. */
  recordUpload(
    userId: string,
    provider: DriveProviderId,
    outcome: { at: Date; error?: string | null },
  ): Promise<void>;
}

type Row = typeof schema.driveConnections.$inferSelect;

function toView(row: Row): DriveConnectionView {
  return {
    provider: row.provider as DriveProviderId,
    accountEmail: row.accountEmail,
    folderName: row.folderName,
    folderId: row.folderId,
    connectedAt: row.createdAt.toISOString(),
    lastUploadAt: row.lastUploadAt ? row.lastUploadAt.toISOString() : null,
    lastError: row.lastError,
  };
}

export class DbDriveStore implements DriveStore {
  async view(userId: string): Promise<DriveConnectionView[]> {
    const rows = await getDb()
      .select()
      .from(schema.driveConnections)
      .where(eq(schema.driveConnections.userId, userId));
    return rows.map(toView);
  }

  async credentials(userId: string, provider: DriveProviderId): Promise<DriveCredentials | null> {
    const rows = await getDb()
      .select()
      .from(schema.driveConnections)
      .where(and(
        eq(schema.driveConnections.userId, userId),
        eq(schema.driveConnections.provider, provider),
      ))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.userId,
      provider: row.provider as DriveProviderId,
      refreshToken: row.refreshToken,
      folderName: row.folderName,
      folderId: row.folderId,
    };
  }

  async connect(userId: string, input: DriveConnectInput): Promise<DriveConnectionView> {
    const now = new Date();
    // Reconnecting replaces the token and clears the previous failure, but
    // keeps the folder the user already has briefs in — re-consenting to fix a
    // revoked grant should not start a second folder beside the first.
    const [row] = await getDb()
      .insert(schema.driveConnections)
      .values({
        userId,
        provider: input.provider,
        refreshToken: input.refreshToken,
        accountEmail: input.accountEmail,
        folderName: input.folderName ?? DEFAULT_DRIVE_FOLDER,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.driveConnections.userId, schema.driveConnections.provider],
        set: {
          refreshToken: input.refreshToken,
          accountEmail: input.accountEmail,
          lastError: null,
          updatedAt: now,
        },
      })
      .returning();
    return toView(row!);
  }

  async disconnect(userId: string, provider: DriveProviderId): Promise<void> {
    await getDb()
      .delete(schema.driveConnections)
      .where(and(
        eq(schema.driveConnections.userId, userId),
        eq(schema.driveConnections.provider, provider),
      ));
  }

  async rememberFolder(userId: string, provider: DriveProviderId, folderId: string): Promise<void> {
    await getDb()
      .update(schema.driveConnections)
      .set({ folderId, updatedAt: new Date() })
      .where(and(
        eq(schema.driveConnections.userId, userId),
        eq(schema.driveConnections.provider, provider),
      ));
  }

  async recordUpload(
    userId: string,
    provider: DriveProviderId,
    outcome: { at: Date; error?: string | null },
  ): Promise<void> {
    await getDb()
      .update(schema.driveConnections)
      .set({
        // Only a success moves the timestamp: `lastUploadAt` answers "when did
        // a brief last actually land in the folder", which is the question the
        // UI asks, and a failed attempt is not an answer to it.
        ...(outcome.error ? {} : { lastUploadAt: outcome.at }),
        lastError: outcome.error ?? null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.driveConnections.userId, userId),
        eq(schema.driveConnections.provider, provider),
      ));
  }
}

/** In-memory variant, for tests and for running without a database. */
export class InMemoryDriveStore implements DriveStore {
  private rows = new Map<string, Row>();
  private key(userId: string, provider: string): string {
    return `${userId}:${provider}`;
  }

  async view(userId: string): Promise<DriveConnectionView[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId).map(toView);
  }

  async credentials(userId: string, provider: DriveProviderId): Promise<DriveCredentials | null> {
    const row = this.rows.get(this.key(userId, provider));
    if (!row) return null;
    return {
      userId: row.userId,
      provider: row.provider as DriveProviderId,
      refreshToken: row.refreshToken,
      folderName: row.folderName,
      folderId: row.folderId,
    };
  }

  async connect(userId: string, input: DriveConnectInput): Promise<DriveConnectionView> {
    const key = this.key(userId, input.provider);
    const now = new Date();
    const existing = this.rows.get(key);
    const row: Row = {
      userId,
      provider: input.provider,
      refreshToken: input.refreshToken,
      accountEmail: input.accountEmail,
      folderName: input.folderName ?? existing?.folderName ?? DEFAULT_DRIVE_FOLDER,
      folderId: existing?.folderId ?? null,
      lastError: null,
      lastUploadAt: existing?.lastUploadAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(key, row);
    return toView(row);
  }

  async disconnect(userId: string, provider: DriveProviderId): Promise<void> {
    this.rows.delete(this.key(userId, provider));
  }

  async rememberFolder(userId: string, provider: DriveProviderId, folderId: string): Promise<void> {
    const row = this.rows.get(this.key(userId, provider));
    if (row) this.rows.set(this.key(userId, provider), { ...row, folderId, updatedAt: new Date() });
  }

  async recordUpload(
    userId: string,
    provider: DriveProviderId,
    outcome: { at: Date; error?: string | null },
  ): Promise<void> {
    const row = this.rows.get(this.key(userId, provider));
    if (!row) return;
    this.rows.set(this.key(userId, provider), {
      ...row,
      lastUploadAt: outcome.error ? row.lastUploadAt : outcome.at,
      lastError: outcome.error ?? null,
      updatedAt: new Date(),
    });
  }
}

export const defaultDriveStore: DriveStore = new DbDriveStore();

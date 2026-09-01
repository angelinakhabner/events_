import type { DriveProviderId } from './cloud-drive.js';
import { DRIVE_PROVIDER_IDS } from './cloud-drive.js';
import {
  driveAccountEmail, exchangeDriveCode, googleDriveAuthUrl, googleDriveConfig,
} from './google-drive.js';
import {
  dropboxAccountEmail, dropboxDriveAuthUrl, dropboxDriveConfig, exchangeDropboxCode,
} from './dropbox-drive.js';

/**
 * The connect half of a drive provider (GOI-93).
 *
 * `cloud-drive.ts` abstracts what a provider does *with* a connection — folders
 * and uploads. This abstracts how a connection is *made*, which is the other
 * half and was previously written straight into the router and the callback
 * route against Google specifically.
 *
 * Splitting it is what keeps adding a third provider to a single new file: the
 * consent URL, the code exchange and the account lookup differ per provider,
 * but the shape of "mint a signed state, redirect, exchange, store" does not,
 * and that shape is security-relevant enough to be worth having exactly once.
 *
 * Deliberately separate from `DriveProvider` rather than folded into it: the
 * sweep imports the provider table on every run and has no business carrying
 * OAuth client secrets or redirect URIs into that code path.
 */
export interface DriveOAuthClient {
  readonly id: DriveProviderId;
  readonly label: string;
  /**
   * The secret this provider's signed state is keyed on.
   *
   * Per provider, not a shared app secret: a state minted for one provider is
   * then not replayable against another's callback. Null when unconfigured,
   * which is also how callers test availability.
   */
  stateSecret(): string | null;
  /** Null when this deployment has no credentials for the provider. */
  authUrl(state: string): string | null;
  exchange(code: string, fetcher?: typeof fetch): Promise<{
    refreshToken: string;
    accessToken: string;
    email: string | null;
  }>;
  accountEmail(accessToken: string, fetcher?: typeof fetch): Promise<string | null>;
}

const google: DriveOAuthClient = {
  id: 'google',
  label: 'Google Drive',
  stateSecret: () => googleDriveConfig()?.clientSecret ?? null,
  authUrl(state) {
    const cfg = googleDriveConfig();
    return cfg ? googleDriveAuthUrl(cfg, state) : null;
  },
  async exchange(code, fetcher) {
    const cfg = googleDriveConfig();
    if (!cfg) throw new Error('Google Drive is not configured on this deployment');
    return exchangeDriveCode(cfg, code, fetcher ? { fetcher } : {});
  },
  accountEmail: (accessToken, fetcher) => driveAccountEmail(accessToken, fetcher ?? fetch),
};

const dropbox: DriveOAuthClient = {
  id: 'dropbox',
  label: 'Dropbox',
  stateSecret: () => dropboxDriveConfig()?.clientSecret ?? null,
  authUrl(state) {
    const cfg = dropboxDriveConfig();
    return cfg ? dropboxDriveAuthUrl(cfg, state) : null;
  },
  async exchange(code, fetcher) {
    const cfg = dropboxDriveConfig();
    if (!cfg) throw new Error('Dropbox is not configured on this deployment');
    return exchangeDropboxCode(cfg, code, fetcher ? { fetcher } : {});
  },
  accountEmail: (accessToken, fetcher) => dropboxAccountEmail(accessToken, fetcher ?? fetch),
};

export const DRIVE_OAUTH: Record<DriveProviderId, DriveOAuthClient> = { google, dropbox };

/** What this deployment can actually offer, for the settings screen. */
export function availableDriveProviders(): { id: DriveProviderId; label: string }[] {
  return DRIVE_PROVIDER_IDS
    .map((id) => DRIVE_OAUTH[id])
    .filter((c) => c.stateSecret() !== null)
    .map((c) => ({ id: c.id, label: c.label }));
}

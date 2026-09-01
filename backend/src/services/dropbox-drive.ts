import { env } from '../config.js';
import { DriveFolderMissingError } from './cloud-drive.js';
import type { DriveProvider, DriveUploadResult } from './cloud-drive.js';

/**
 * Dropbox, as the newsletter's second filing cabinet (GOI-93).
 *
 * Written against the REST API directly, matching `google-drive.ts`: the
 * official SDK is a large dependency for what is six HTTP calls, and the two
 * providers being written the same way makes them readable side by side.
 *
 * **Register the Dropbox app with "App folder" access, not "Full Dropbox".**
 * That confines AFISZ to a single folder Dropbox creates for it — the app can
 * neither see nor touch anything else the user keeps there. It is the closest
 * analogue to the `drive.file` scope Google uses, and it is the reason the
 * paths below are absolute-looking (`/Briefs`) yet harmless: for an app-folder
 * app, `/` *is* the app's own folder, not the user's Dropbox root. The scopes
 * to tick are `files.content.write`, `files.content.read` and
 * `account_info.read`.
 */

const TOKEN_ENDPOINT = 'https://api.dropboxapi.com/oauth2/token';
const AUTH_ENDPOINT = 'https://www.dropbox.com/oauth2/authorize';
const RPC = 'https://api.dropboxapi.com/2';
const CONTENT_UPLOAD = 'https://content.dropboxapi.com/2/files/upload';

export interface DropboxDriveConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Config from env, or null when this deployment has no Dropbox credentials
 *  (it then reports itself unavailable rather than failing at connect time). */
export function dropboxDriveConfig(): DropboxDriveConfig | null {
  if (!env.DROPBOX_CLIENT_ID || !env.DROPBOX_CLIENT_SECRET || !env.API_PUBLIC_URL) return null;
  return {
    clientId: env.DROPBOX_CLIENT_ID,
    clientSecret: env.DROPBOX_CLIENT_SECRET,
    redirectUri: `${env.API_PUBLIC_URL.replace(/\/$/, '')}/auth/dropbox/drive/callback`,
  };
}

/**
 * Consent screen for connecting a Dropbox.
 *
 * `token_access_type=offline` is the one parameter that matters and the one
 * that is easy to miss: without it Dropbox returns a four-hour access token
 * and no refresh token, and the connection works perfectly until the evening
 * of the day it was made. Briefs are filed by a scheduled sweep with nobody at
 * the keyboard, so a refresh token is the whole point.
 */
export function dropboxDriveAuthUrl(cfg: DropboxDriveConfig, state: string): string {
  const u = new URL(AUTH_ENDPOINT);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('token_access_type', 'offline');
  u.searchParams.set('state', state);
  return u.toString();
}

export interface DropboxTokens {
  refreshToken: string;
  accessToken: string;
  email: string | null;
}

/** Exchange the consent code for a refresh token. */
export async function exchangeDropboxCode(
  cfg: DropboxDriveConfig,
  code: string,
  opts: { fetcher?: typeof fetch } = {},
): Promise<DropboxTokens> {
  const fetcher = opts.fetcher ?? fetch;
  const res = await fetcher(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Connecting Dropbox failed (token exchange HTTP ${res.status})`);

  const body = (await res.json()) as { refresh_token?: string; access_token?: string };
  if (!body.access_token) throw new Error('Connecting Dropbox failed (no access token)');
  // Same reasoning as Google's: a connection that cannot refresh looks healthy
  // and then stops filing briefs hours later, with nothing to point at.
  if (!body.refresh_token) {
    throw new Error(
      'Connecting Dropbox failed (Dropbox returned no refresh token — the app is not ' +
      'requesting offline access)',
    );
  }
  return { refreshToken: body.refresh_token, accessToken: body.access_token, email: null };
}

/** Trade the stored refresh token for a fresh access token. */
export async function refreshDropboxToken(
  cfg: DropboxDriveConfig,
  refreshToken: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const res = await fetcher(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }).toString(),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      throw new Error('Dropbox access was revoked — reconnect it in Newsletter settings');
    }
    throw new Error(`Dropbox token refresh failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('Dropbox token refresh returned no access token');
  return body.access_token;
}

/** The connected account's address, for showing which Dropbox this is. */
export async function dropboxAccountEmail(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    // `users/get_current_account` takes no arguments, and Dropbox rejects an
    // RPC call that sends a content-type with an empty body.
    const res = await fetcher(`${RPC}/users/get_current_account`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { email?: string };
    return body.email ?? null;
  } catch {
    return null;
  }
}

/**
 * A Dropbox RPC call. Errors carry a machine-readable `error_summary`, which is
 * what the callers below match on rather than the HTTP status: Dropbox answers
 * "that folder does not exist" and "that folder already exists" with the same
 * 409.
 */
async function rpc<T>(
  accessToken: string,
  path: string,
  args: unknown,
  fetcher: typeof fetch,
): Promise<{ ok: true; body: T } | { ok: false; status: number; summary: string }> {
  const res = await fetcher(`${RPC}/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (res.ok) return { ok: true, body: (await res.json()) as T };
  let summary = '';
  try {
    const err = (await res.json()) as { error_summary?: string };
    summary = err.error_summary ?? '';
  } catch {
    summary = '';
  }
  return { ok: false, status: res.status, summary };
}

/**
 * A folder name as a Dropbox path.
 *
 * The name is user-supplied and Dropbox rejects a path containing any of
 * `/ \ : ? * < > " |`, so they are replaced rather than passed through to
 * become a rejected upload a day later. Trailing dots and spaces go too —
 * Dropbox silently trims them, which would leave the stored name disagreeing
 * with the folder the user can actually see.
 */
function folderPath(name: string): string {
  const safe = name.replace(/[/\\:?*<>"|]/g, '-').replace(/[.\s]+$/, '').trim();
  return `/${safe || 'AFISZ'}`;
}

/**
 * Dropbox passes call arguments in an HTTP *header* on content endpoints, and
 * headers are ASCII. A folder called "Wydarzenia — wrzesień" would make the
 * upload fail with a header parse error, so non-ASCII is escaped the way
 * Dropbox documents: `\uXXXX`, which their parser reads back.
 */
function apiArg(value: unknown): string {
  return JSON.stringify(value).replace(
    /[-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

interface FolderMetadata {
  '.tag'?: string;
  id?: string;
  path_lower?: string;
}

/**
 * Resolve a stored folder id to the path Dropbox's content endpoints need.
 *
 * This is the whole reason `ensureFolder` stores an `id:…` rather than the
 * path. Dropbox ids survive a rename or a move; paths do not, and the
 * `DriveProvider` contract says a stored folder id must still work after
 * `renameFolder` — the store keeps the old one deliberately. Paying one lookup
 * per upload buys that, and buys "the user dragged the folder somewhere else
 * and briefs kept arriving" for free.
 */
async function resolvePath(
  accessToken: string,
  folderId: string,
  fetcher: typeof fetch,
): Promise<string> {
  const got = await rpc<FolderMetadata>(accessToken, 'files/get_metadata', { path: folderId }, fetcher);
  if (!got.ok) {
    if (got.summary.startsWith('path/not_found')) {
      throw new DriveFolderMissingError(
        'That folder is no longer in your Dropbox — it will be recreated with the next brief.',
      );
    }
    throw new Error(`Dropbox folder lookup failed (HTTP ${got.status})`);
  }
  if (got.body['.tag'] === 'deleted') {
    throw new DriveFolderMissingError(
      'That folder is no longer in your Dropbox — it will be recreated with the next brief.',
    );
  }
  const path = got.body.path_lower;
  if (!path) throw new Error('Dropbox returned a folder with no path');
  return path;
}

function requireConfig(): DropboxDriveConfig {
  const cfg = dropboxDriveConfig();
  if (!cfg) throw new Error('Dropbox is not configured on this deployment');
  return cfg;
}

export const dropboxDriveProvider: DriveProvider = {
  id: 'dropbox',
  label: 'Dropbox',

  async ensureFolder({ refreshToken, folderName, knownFolderId, fetcher = fetch }) {
    const cfg = requireConfig();
    const accessToken = await refreshDropboxToken(cfg, refreshToken, fetcher);

    // A stored id is re-verified rather than trusted — the user can delete the
    // folder, and Dropbox would then happily recreate the path on upload,
    // silently orphaning the id we still hold.
    if (knownFolderId) {
      const got = await rpc<FolderMetadata>(
        accessToken, 'files/get_metadata', { path: knownFolderId }, fetcher,
      );
      if (got.ok && got.body['.tag'] === 'folder' && got.body.id) {
        return { folderId: got.body.id, created: false };
      }
      if (!got.ok && !got.summary.startsWith('path/not_found')) {
        throw new Error(`Dropbox folder check failed (HTTP ${got.status})`);
      }
    }

    const path = folderPath(folderName);
    const created = await rpc<{ metadata?: FolderMetadata }>(
      accessToken, 'files/create_folder_v2', { path, autorename: false }, fetcher,
    );
    if (created.ok) {
      const id = created.body.metadata?.id;
      if (!id) throw new Error('Creating the Dropbox folder returned no id');
      return { folderId: id, created: true };
    }
    // Already there — from a previous connection, or the user made it by hand.
    // Adopt it rather than autorenaming into "Briefs (1)".
    if (created.summary.startsWith('path/conflict')) {
      const got = await rpc<FolderMetadata>(
        accessToken, 'files/get_metadata', { path }, fetcher,
      );
      if (got.ok && got.body.id) return { folderId: got.body.id, created: false };
    }
    throw new Error(`Creating the Dropbox folder failed (HTTP ${created.status})`);
  },

  async upload({ refreshToken, folderId, file, fetcher = fetch }): Promise<DriveUploadResult> {
    const cfg = requireConfig();
    const accessToken = await refreshDropboxToken(cfg, refreshToken, fetcher);
    const dir = await resolvePath(accessToken, folderId, fetcher);

    const res = await fetcher(CONTENT_UPLOAD, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/octet-stream',
        // `autorename` rather than `overwrite`: two briefs filed on one day is
        // odd, but losing the first one to the second is worse.
        'Dropbox-API-Arg': apiArg({
          path: `${dir}/${file.filename}`,
          mode: 'add',
          autorename: true,
          mute: true,
        }),
      },
      body: file.body as unknown as BodyInit,
    });
    if (!res.ok) throw new Error(`Uploading the brief to Dropbox failed (HTTP ${res.status})`);

    const parsed = (await res.json()) as { id?: string };
    if (!parsed.id) throw new Error('Dropbox accepted the upload but returned no file id');
    // Dropbox gives no viewable URL on upload — a shared link is a separate
    // call that also makes the file public, which is not what filing a private
    // brief should quietly do. The interface allows null for exactly this.
    return { fileId: parsed.id, webUrl: null };
  },

  async renameFolder({ refreshToken, folderId, name, fetcher = fetch }) {
    const cfg = requireConfig();
    const accessToken = await refreshDropboxToken(cfg, refreshToken, fetcher);
    // Throws `DriveFolderMissingError` when the folder is gone, which is
    // exactly what the caller wants: take the new name, forget the id.
    const from = await resolvePath(accessToken, folderId, fetcher);
    const to = folderPath(name);
    if (from === to.toLowerCase()) return;

    const moved = await rpc<unknown>(
      accessToken, 'files/move_v2', { from_path: from, to_path: to, autorename: false }, fetcher,
    );
    if (moved.ok) return;
    if (moved.summary.startsWith('from_lookup/not_found')) {
      throw new DriveFolderMissingError(
        'That folder is no longer in your Dropbox — it will be recreated with the next brief.',
      );
    }
    if (moved.summary.startsWith('to/conflict')) {
      throw new Error(`A folder called “${name}” is already in your Dropbox — pick another name.`);
    }
    throw new Error(`Renaming the Dropbox folder failed (HTTP ${moved.status})`);
  },
};

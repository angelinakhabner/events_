import { env } from '../config.js';
import { DriveFolderMissingError } from './cloud-drive.js';
import type { DriveProvider, DriveUpload, DriveUploadResult } from './cloud-drive.js';

/**
 * Google Drive, as the newsletter's filing cabinet (GOI-91).
 *
 * Written against the REST API directly rather than `googleapis`, matching the
 * choice already made in `google-auth.ts`: that package is tens of megabytes to
 * pull in three endpoints, and the flow here is four HTTP calls.
 *
 * **Scope is `drive.file`, and that is the point.** It grants access only to
 * files this app itself created — AFISZ can write briefs into its own folder
 * and can see nothing else in the user's Drive. It is also, unlike the broader
 * `drive` scope, a non-sensitive scope, so enabling it needs no Google
 * verification review. Widening it would change both of those facts.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Config from env, or null when the feature isn't set up (it then reports
 *  itself unavailable rather than failing at connect time). */
export function googleDriveConfig(): GoogleDriveConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.API_PUBLIC_URL) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${env.API_PUBLIC_URL.replace(/\/$/, '')}/auth/google/drive/callback`,
  };
}

/**
 * Consent screen for connecting a drive.
 *
 * `access_type=offline` + `prompt=consent` is what makes this different from
 * the sign-in URL: briefs are uploaded by a scheduled sweep with nobody at the
 * keyboard, so a refresh token is required. Google only returns one on the
 * *first* consent for a scope, and returns nothing on a re-connect — forcing
 * the prompt is the documented way to always get one back, and without it
 * re-connecting a drive silently yields a connection that cannot refresh.
 */
export function googleDriveAuthUrl(cfg: GoogleDriveConfig, state: string): string {
  const u = new URL(AUTH_ENDPOINT);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', `${DRIVE_SCOPE} openid email`);
  u.searchParams.set('state', state);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  return u.toString();
}

export interface DriveTokens {
  refreshToken: string;
  accessToken: string;
  /** The Google account the drive belongs to, when the id_token carried it. */
  email: string | null;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const segment = jwt.split('.')[1];
  if (!segment) return null;
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Exchange the consent code for a refresh token. */
export async function exchangeDriveCode(
  cfg: GoogleDriveConfig,
  code: string,
  opts: { fetcher?: typeof fetch } = {},
): Promise<DriveTokens> {
  const fetcher = opts.fetcher ?? fetch;
  const res = await fetcher(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) throw new Error(`Connecting Google Drive failed (token exchange HTTP ${res.status})`);

  const body = (await res.json()) as {
    refresh_token?: string; access_token?: string; id_token?: string; scope?: string;
  };
  if (!body.access_token) throw new Error('Connecting Google Drive failed (no access token)');
  // Without this the connection looks fine and then cannot upload anything
  // once the first access token expires, an hour later. Fail now, loudly.
  if (!body.refresh_token) {
    throw new Error(
      'Connecting Google Drive failed (Google returned no refresh token — ' +
      'revoke AFISZ at myaccount.google.com/permissions and connect again)',
    );
  }
  if (body.scope && !body.scope.split(' ').includes(DRIVE_SCOPE)) {
    throw new Error('Connecting Google Drive failed (the Drive permission was not granted)');
  }

  const claims = body.id_token ? decodeJwtPayload(body.id_token) : null;
  const email = claims && typeof claims.email === 'string' ? claims.email : null;
  return { refreshToken: body.refresh_token, accessToken: body.access_token, email };
}

/** Trade the stored refresh token for a fresh access token. */
export async function refreshAccessToken(
  cfg: GoogleDriveConfig,
  refreshToken: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const res = await fetcher(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) {
    // 400 here is all but always a revoked or expired grant, which the user
    // has to fix by reconnecting — say that rather than printing a status.
    if (res.status === 400 || res.status === 401) {
      throw new Error('Google Drive access was revoked — reconnect it in Newsletter settings');
    }
    throw new Error(`Google Drive token refresh failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('Google Drive token refresh returned no access token');
  return body.access_token;
}

/** The connected account's address, for showing which Drive this is. */
export async function driveAccountEmail(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetcher(USERINFO, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const body = (await res.json()) as { email?: string };
    return body.email ?? null;
  } catch {
    return null;
  }
}

/** Google's query syntax has no escape for `'`, so a folder name carrying one
 *  would break out of the literal. Backslash-escaping is what the API docs
 *  prescribe; the name is user-supplied, so this is not optional. */
function escapeQueryLiteral(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFolder(
  accessToken: string,
  name: string,
  fetcher: typeof fetch,
): Promise<string | null> {
  const q = [
    `mimeType='${FOLDER_MIME}'`,
    `name='${escapeQueryLiteral(name)}'`,
    'trashed=false',
  ].join(' and ');
  const url = new URL(DRIVE_FILES);
  url.searchParams.set('q', q);
  url.searchParams.set('fields', 'files(id,name)');
  url.searchParams.set('pageSize', '10');

  const res = await fetcher(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google Drive folder lookup failed (HTTP ${res.status})`);
  const body = (await res.json()) as { files?: { id: string }[] };
  return body.files?.[0]?.id ?? null;
}

async function createFolder(
  accessToken: string,
  name: string,
  fetcher: typeof fetch,
): Promise<string> {
  const res = await fetcher(`${DRIVE_FILES}?fields=id`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
  });
  if (!res.ok) throw new Error(`Creating the Google Drive folder failed (HTTP ${res.status})`);
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error('Creating the Google Drive folder returned no id');
  return body.id;
}

/** True when the stored folder id still points at a live, untrashed folder. */
async function folderStillThere(
  accessToken: string,
  folderId: string,
  fetcher: typeof fetch,
): Promise<boolean> {
  const url = new URL(`${DRIVE_FILES}/${encodeURIComponent(folderId)}`);
  url.searchParams.set('fields', 'id,trashed');
  const res = await fetcher(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Google Drive folder check failed (HTTP ${res.status})`);
  const body = (await res.json()) as { trashed?: boolean };
  return body.trashed !== true;
}

function requireConfig(): GoogleDriveConfig {
  const cfg = googleDriveConfig();
  if (!cfg) throw new Error('Google Drive is not configured on this deployment');
  return cfg;
}

export const googleDriveProvider: DriveProvider = {
  id: 'google',
  label: 'Google Drive',

  async ensureFolder({ refreshToken, folderName, knownFolderId, fetcher = fetch }) {
    const cfg = requireConfig();
    const accessToken = await refreshAccessToken(cfg, refreshToken, fetcher);

    // A stored id is re-verified rather than trusted: the user can move the
    // folder to the bin, and uploading into a trashed folder "succeeds" while
    // putting the brief somewhere they will never look.
    if (knownFolderId && (await folderStillThere(accessToken, knownFolderId, fetcher))) {
      return { folderId: knownFolderId, created: false };
    }
    const found = await findFolder(accessToken, folderName, fetcher);
    if (found) return { folderId: found, created: false };
    return { folderId: await createFolder(accessToken, folderName, fetcher), created: true };
  },

  async upload({ refreshToken, folderId, file, fetcher = fetch }): Promise<DriveUploadResult> {
    const cfg = requireConfig();
    const accessToken = await refreshAccessToken(cfg, refreshToken, fetcher);
    return uploadMultipart(accessToken, folderId, file, fetcher);
  },

  async renameFolder({ refreshToken, folderId, name, fetcher = fetch }) {
    const cfg = requireConfig();
    const accessToken = await refreshAccessToken(cfg, refreshToken, fetcher);
    const url = new URL(`${DRIVE_FILES}/${encodeURIComponent(folderId)}`);
    url.searchParams.set('fields', 'id');
    const res = await fetcher(url.toString(), {
      method: 'PATCH',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    // A 404 here means the folder is gone from the user's Drive, not that the
    // name is bad. Say so: the fix is to let the next send recreate it, which
    // is what the caller does when it clears the stored id.
    if (res.status === 404) {
      throw new DriveFolderMissingError(
        'That folder is no longer in your Drive — it will be recreated with the next brief.',
      );
    }
    if (!res.ok) throw new Error(`Renaming the Google Drive folder failed (HTTP ${res.status})`);
  },
};

/**
 * Drive's multipart upload: metadata part, then the bytes, in one request.
 *
 * Assembled by hand rather than with `FormData` because Drive requires
 * `multipart/related` (not `form-data`), which `FormData` cannot produce.
 */
async function uploadMultipart(
  accessToken: string,
  folderId: string,
  file: DriveUpload,
  fetcher: typeof fetch,
): Promise<DriveUploadResult> {
  const boundary = `afisz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name: file.filename, parents: [folderId] });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetcher(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': `multipart/related; boundary=${boundary}`,
    },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`Uploading the brief to Google Drive failed (HTTP ${res.status})`);

  const parsed = (await res.json()) as { id?: string; webViewLink?: string };
  if (!parsed.id) throw new Error('Google Drive accepted the upload but returned no file id');
  return { fileId: parsed.id, webUrl: parsed.webViewLink ?? null };
}

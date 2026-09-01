/**
 * Filing the brief on a user's own cloud drive (GOI-91).
 *
 * The ticket asks for Google Drive "and some other popular drives", so this
 * file is the provider-independent half: a small interface, the connection
 * record, and the upload the newsletter sweep calls. Adding a provider means
 * writing one more object that satisfies `DriveProvider` and adding its id to
 * the union — no change to the sweep, the store, or the UI's shape.
 *
 * Google and Dropbox are implemented (GOI-93). Dropbox was the second one
 * precisely because it is the least like Google of the popular drives — it
 * addresses files by path where Google uses opaque ids — so making it fit
 * without bending the interface is evidence the interface is the right shape.
 * OneDrive would be a third object here and nothing else.
 */

/**
 * Providers this build can talk to. Defined in `shared` (the settings card
 * renders from the same list) and re-exported here so the drive code can go on
 * importing it from its own module.
 */
import type { DriveProviderId } from '@afisz/shared';

export type { DriveProviderId } from '@afisz/shared';
export { DRIVE_PROVIDER_IDS } from '@afisz/shared';

export interface DriveUpload {
  filename: string;
  /** `application/pdf` today; the interface takes it explicitly so a provider
   *  never has to infer a type from the extension. */
  contentType: string;
  body: Buffer;
}

export interface DriveUploadResult {
  fileId: string;
  /** Where the user can open it. Null when the provider gives no direct link. */
  webUrl: string | null;
}

/**
 * One provider's half of the job.
 *
 * Both methods take the connection's refresh token rather than an access
 * token: access tokens live about an hour and briefs go out on a schedule, so
 * every call here starts from cold and refreshes for itself.
 */
export interface DriveProvider {
  readonly id: DriveProviderId;
  /** Human-readable, for the connect button and error copy. */
  readonly label: string;
  /**
   * Find the app's folder, creating it when it isn't there. Returns the id to
   * store, so the common case costs one lookup rather than a search.
   *
   * Whatever a provider returns here it must still accept after the folder has
   * been renamed or moved — `renameFolder` does not hand back a new one, and
   * the store deliberately keeps the old one on a rename. For Google that is
   * free (ids are opaque and stable). A path-addressed provider must therefore
   * return something stable too and resolve it to a path itself, rather than
   * returning the path: see `dropbox-drive.ts`.
   */
  ensureFolder(args: {
    refreshToken: string;
    folderName: string;
    /** Previously stored id. Re-verified, since a user can delete the folder. */
    knownFolderId?: string | null;
    fetcher?: typeof fetch;
  }): Promise<{ folderId: string; created: boolean }>;

  upload(args: {
    refreshToken: string;
    folderId: string;
    file: DriveUpload;
    fetcher?: typeof fetch;
  }): Promise<DriveUploadResult>;

  /**
   * Rename the app's folder in place, keeping the briefs already in it.
   *
   * Renaming rather than pointing at a fresh folder is the whole reason this
   * is a provider method: the alternative — store the new name and let
   * `ensureFolder` find-or-create it on the next send — silently strands every
   * brief filed so far in a folder the user has stopped looking at.
   */
  renameFolder(args: {
    refreshToken: string;
    folderId: string;
    name: string;
    fetcher?: typeof fetch;
  }): Promise<void>;
}

/**
 * The app's folder is no longer in the user's drive.
 *
 * A distinct type rather than a message a caller has to pattern-match: the
 * recovery (forget the cached id so the next send recreates the folder) is
 * different from every other failure, and matching on error text breaks the
 * moment a provider rewords one.
 */
export class DriveFolderMissingError extends Error {
  constructor(message = 'The folder is no longer in the drive.') {
    super(message);
    this.name = 'DriveFolderMissingError';
  }
}

/**
 * A drive connection as the rest of the app sees it.
 *
 * `refreshToken` is deliberately absent: it is the one field that must never
 * leave the backend, and leaving it off the shared type means a router that
 * returns a connection to the browser cannot leak it by accident.
 */
export interface DriveConnectionView {
  provider: DriveProviderId;
  /** The drive account the folder lives in, so a user can tell which of their
   *  Google accounts they connected. */
  accountEmail: string | null;
  folderName: string;
  folderId: string | null;
  connectedAt: string;
  lastUploadAt: string | null;
  /** Last failure, cleared by the next success. Surfaced in the UI: a drive
   *  that quietly stopped receiving briefs is the failure mode worth naming. */
  lastError: string | null;
}

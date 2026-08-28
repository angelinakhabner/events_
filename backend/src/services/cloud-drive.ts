/**
 * Filing the brief on a user's own cloud drive (GOI-91).
 *
 * The ticket asks for Google Drive "and some other popular drives", so this
 * file is the provider-independent half: a small interface, the connection
 * record, and the upload the newsletter sweep calls. Adding Dropbox or OneDrive
 * later means writing one more object that satisfies `DriveProvider` and adding
 * its id to the union — no change to the sweep, the store, or the UI's shape.
 *
 * Only Google is implemented today; see the note on `DriveProviderId`.
 */

/**
 * Providers this build can talk to.
 *
 * Kept as a union rather than a bare string so the store, the router and the
 * frontend all fail to compile against a provider nobody wrote a client for —
 * the alternative is a runtime "unknown provider" branch nobody ever hits until
 * a typo in a config reaches production.
 */
export type DriveProviderId = 'google';

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

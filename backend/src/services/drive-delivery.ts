import { googleDriveProvider } from './google-drive.js';
import { dropboxDriveProvider } from './dropbox-drive.js';
import { defaultDriveStore, type DriveStore } from './drive-store.js';
import { briefPdfFilename, renderBriefPdf, type BriefPdfContent } from './newsletter-pdf.js';
import { DriveFolderMissingError } from './cloud-drive.js';
import type { DriveProvider, DriveProviderId } from './cloud-drive.js';
import { normalizeDriveFolderName, type NewsletterFrequency } from '@afisz/shared';

/**
 * Filing one brief on a user's drive (GOI-91).
 *
 * Sits between the newsletter sweep and the providers so the sweep knows
 * nothing about OAuth, folders or multipart bodies — it hands over the brief it
 * just emailed and gets back an outcome it can report.
 */

/** The provider clients, by id. Exported so the OAuth callback can create the
 *  folder right after a connection without re-deriving the table (GOI-93). */
export const driveProviders: Record<DriveProviderId, DriveProvider> = {
  google: googleDriveProvider,
  dropbox: dropboxDriveProvider,
};

export type DriveDeliveryStatus = 'uploaded' | 'skipped' | 'failed';

export interface DriveDeliveryOutcome {
  provider: DriveProviderId;
  status: DriveDeliveryStatus;
  /** Set when uploaded and the provider gave a link. */
  webUrl?: string | null;
  filename?: string;
  reason?: string;
}

export interface DeliverOptions {
  store?: DriveStore;
  fetcher?: typeof fetch;
  /** Injected in tests; defaults to the real provider table. */
  providers?: Partial<Record<DriveProviderId, DriveProvider>>;
  now?: Date;
}

/**
 * Render the brief as a PDF and put it in every drive this user has connected.
 *
 * **Never throws**, and the caller decides what that silence means. When the
 * reader is also being emailed, a drive that is full, revoked or simply down
 * must not turn a brief they received into a failed send — there, the email is
 * the product and the filed copy is a convenience.
 *
 * For a `drive`-only reader that reasoning does not hold: the filed PDF *is*
 * the delivery, and returning an outcome of nothing but failures means they
 * got nothing at all. So the outcomes are returned rather than swallowed, and
 * the sweep reads them — it marks the issue sent only once at least one upload
 * succeeded. Failures are also recorded on the connection, where the
 * Newsletter tab shows them.
 */
export async function deliverBriefToDrives(
  userId: string,
  brief: BriefPdfContent,
  frequency: NewsletterFrequency,
  opts: DeliverOptions = {},
): Promise<DriveDeliveryOutcome[]> {
  const store = opts.store ?? defaultDriveStore;
  const providers = { ...driveProviders, ...opts.providers };
  const now = opts.now ?? brief.now ?? new Date();

  let connections: Awaited<ReturnType<DriveStore['view']>>;
  try {
    connections = await store.view(userId);
  } catch (e) {
    console.warn(`[drive] could not read connections for ${userId}: ${message(e)}`);
    return [];
  }
  if (connections.length === 0) return [];

  // Rendered once, however many drives it goes to.
  let pdf: Buffer;
  try {
    pdf = await renderBriefPdf({ ...brief, now });
  } catch (e) {
    const reason = `could not render the PDF: ${message(e)}`;
    console.error(`[drive] ${reason}`);
    return connections.map((c) => ({ provider: c.provider, status: 'failed' as const, reason }));
  }

  const filename = briefPdfFilename(now, frequency);
  const outcomes: DriveDeliveryOutcome[] = [];

  for (const connection of connections) {
    const provider = providers[connection.provider];
    if (!provider) {
      outcomes.push({
        provider: connection.provider, status: 'skipped',
        reason: `no client for provider "${connection.provider}"`,
      });
      continue;
    }
    outcomes.push(
      await deliverOne(userId, provider, filename, pdf, store, now, opts.fetcher),
    );
  }
  return outcomes;
}

/**
 * Change the folder a user's briefs are filed in, renaming it in the drive.
 *
 * **Throws**, unlike `deliverBriefToDrives`. The difference is who is waiting:
 * a scheduled upload must never turn a sent brief into a failed send, but this
 * runs from a button with someone watching, and a rename that silently did
 * nothing would leave the UI showing a name the drive does not have.
 */
export async function renameDriveFolder(
  userId: string,
  providerId: DriveProviderId,
  rawName: string,
  opts: DeliverOptions = {},
): Promise<{ folderName: string; recreated: boolean }> {
  const store = opts.store ?? defaultDriveStore;
  const providers = { ...driveProviders, ...opts.providers };
  const name = normalizeDriveFolderName(rawName);

  const provider = providers[providerId];
  if (!provider) throw new Error(`No client for provider "${providerId}".`);

  const credentials = await store.credentials(userId, providerId);
  if (!credentials) throw new Error('No drive is connected.');
  if (credentials.folderName === name) return { folderName: name, recreated: false };

  // Connected but the folder was never created (the post-connect attempt can
  // fail). Nothing to rename — the next send creates it under the new name.
  if (!credentials.folderId) {
    await store.setFolderName(userId, providerId, name);
    return { folderName: name, recreated: true };
  }

  try {
    await provider.renameFolder({
      refreshToken: credentials.refreshToken,
      folderId: credentials.folderId,
      name,
      fetcher: opts.fetcher,
    });
  } catch (e) {
    // The folder is gone, so there is nothing to rename and nothing to strand:
    // take the new name and forget the id so the next send recreates it.
    if (e instanceof DriveFolderMissingError) {
      await store.setFolderName(userId, providerId, name, null);
      return { folderName: name, recreated: true };
    }
    throw e;
  }

  // Only after the drive agrees: the stored name is a promise about what the
  // user will find in their drive, not a preference.
  await store.setFolderName(userId, providerId, name);
  return { folderName: name, recreated: false };
}

async function deliverOne(
  userId: string,
  provider: DriveProvider,
  filename: string,
  pdf: Buffer,
  store: DriveStore,
  now: Date,
  fetcher?: typeof fetch,
): Promise<DriveDeliveryOutcome> {
  try {
    const credentials = await store.credentials(userId, provider.id);
    if (!credentials) {
      return { provider: provider.id, status: 'skipped', reason: 'connection disappeared' };
    }

    const folder = await provider.ensureFolder({
      refreshToken: credentials.refreshToken,
      folderName: credentials.folderName,
      knownFolderId: credentials.folderId,
      fetcher,
    });
    if (folder.folderId !== credentials.folderId) {
      await store.rememberFolder(userId, provider.id, folder.folderId);
    }

    const result = await provider.upload({
      refreshToken: credentials.refreshToken,
      folderId: folder.folderId,
      file: { filename, contentType: 'application/pdf', body: pdf },
      fetcher,
    });

    await store.recordUpload(userId, provider.id, { at: now, error: null });
    return { provider: provider.id, status: 'uploaded', webUrl: result.webUrl, filename };
  } catch (e) {
    const reason = message(e);
    console.warn(`[drive] ${provider.label} upload for ${userId} failed: ${reason}`);
    // Best-effort: if even recording the failure fails, the brief still went
    // out by email and this must not escalate.
    await store
      .recordUpload(userId, provider.id, { at: now, error: reason })
      .catch(() => undefined);
    return { provider: provider.id, status: 'failed', reason };
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

import { googleDriveProvider } from './google-drive.js';
import { defaultDriveStore, type DriveStore } from './drive-store.js';
import { briefPdfFilename, renderBriefPdf, type BriefPdfContent } from './newsletter-pdf.js';
import type { DriveProvider, DriveProviderId } from './cloud-drive.js';
import type { NewsletterFrequency } from '@afisz/shared';

/**
 * Filing one brief on a user's drive (GOI-91).
 *
 * Sits between the newsletter sweep and the providers so the sweep knows
 * nothing about OAuth, folders or multipart bodies — it hands over the brief it
 * just emailed and gets back an outcome it can report.
 */

const PROVIDERS: Record<DriveProviderId, DriveProvider> = {
  google: googleDriveProvider,
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
 * **Never throws.** A drive that is full, revoked or simply down must not turn
 * a brief that was successfully emailed into a failed send — the email is the
 * product, the filed copy is a convenience. Failures are recorded on the
 * connection instead, where the Newsletter tab shows them.
 */
export async function deliverBriefToDrives(
  userId: string,
  brief: BriefPdfContent,
  frequency: NewsletterFrequency,
  opts: DeliverOptions = {},
): Promise<DriveDeliveryOutcome[]> {
  const store = opts.store ?? defaultDriveStore;
  const providers = { ...PROVIDERS, ...opts.providers };
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

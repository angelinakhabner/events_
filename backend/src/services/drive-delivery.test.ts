import { describe, it, expect } from 'vitest';
import type { Event } from '@afisz/shared';
import { deliverBriefToDrives, renameDriveFolder } from './drive-delivery.js';
import { InMemoryDriveStore } from './drive-store.js';
import { DriveFolderMissingError } from './cloud-drive.js';
import { DEFAULT_DRIVE_FOLDER, normalizeDriveFolderName } from '@afisz/shared';
import type { DriveProvider } from './cloud-drive.js';
import type { BriefSection } from './newsletter-render.js';

const USER = 'user-1';
const NOW = new Date('2026-09-09T08:00:00.000Z');

const sections = [
  {
    category: 'cinema',
    frequency: 'weekly',
    detail: 'full',
    events: [
      {
        id: 'e1', venueId: 'v1', title: 'Zimna wojna', description: null,
        startsAt: '2026-09-10T16:00:00.000Z', endsAt: null, kind: 'timed',
        category: 'cinema', language: 'pl',
        sourceUrl: 'https://kinomuranow.pl/film/zimna-wojna',
        venue: { id: 'v1', name: 'Kino Muranów', city: 'Warsaw' },
      } as unknown as Event,
    ],
  },
] as unknown as BriefSection[];

/** A provider that records what it was asked to do. */
function fakeProvider(over: Partial<DriveProvider> = {}) {
  const uploads: { folderId: string; filename: string; bytes: number }[] = [];
  const renames: { folderId: string; name: string }[] = [];
  const provider: DriveProvider = {
    id: 'google',
    label: 'Google Drive',
    async ensureFolder() {
      return { folderId: 'folder-1', created: false };
    },
    async upload({ folderId, file }) {
      uploads.push({ folderId, filename: file.filename, bytes: file.body.length });
      return { fileId: 'file-1', webUrl: 'https://drive.google.com/file/d/file-1' };
    },
    async renameFolder({ folderId, name }) {
      renames.push({ folderId, name });
    },
    ...over,
  };
  return { provider, uploads, renames };
}

async function connectedStore() {
  const store = new InMemoryDriveStore();
  await store.connect(USER, { provider: 'google', refreshToken: 'rt', accountEmail: 'ada@example.com' });
  return store;
}

describe('deliverBriefToDrives', () => {
  it('does nothing at all for a user with no drive connected', async () => {
    const { provider, uploads } = fakeProvider();
    const out = await deliverBriefToDrives(USER, { sections, now: NOW }, 'weekly', {
      store: new InMemoryDriveStore(),
      providers: { google: provider },
    });

    expect(out).toEqual([]);
    expect(uploads).toHaveLength(0);
  });

  it('files a real PDF under a date-led name', async () => {
    const store = await connectedStore();
    const { provider, uploads } = fakeProvider();

    const out = await deliverBriefToDrives(USER, { sections, now: NOW }, 'weekly', {
      store, providers: { google: provider },
    });

    expect(out).toEqual([{
      provider: 'google', status: 'uploaded',
      webUrl: 'https://drive.google.com/file/d/file-1',
      filename: 'afisz-2026-09-09-weekly.pdf',
    }]);
    expect(uploads[0]!.folderId).toBe('folder-1');
    expect(uploads[0]!.bytes).toBeGreaterThan(1000);

    const view = (await store.view(USER))[0]!;
    expect(view.lastUploadAt).toBe(NOW.toISOString());
    expect(view.lastError).toBeNull();
  });

  it('caches a newly created folder so the next send skips the lookup', async () => {
    const store = await connectedStore();
    let ensures = 0;
    const { provider } = fakeProvider({
      async ensureFolder() {
        ensures++;
        return { folderId: 'folder-9', created: true };
      },
    });

    await deliverBriefToDrives(USER, { sections, now: NOW }, 'weekly', { store, providers: { google: provider } });

    expect(ensures).toBe(1);
    expect((await store.credentials(USER, 'google'))!.folderId).toBe('folder-9');
  });

  /**
   * The contract that matters most: the email is the product and has already
   * been sent by the time this runs. A drive that is full, revoked or simply
   * down must never turn a delivered brief into a failed one.
   */
  it('never throws when the provider fails, and records why', async () => {
    const store = await connectedStore();
    const { provider } = fakeProvider({
      async upload() {
        throw new Error('Google Drive storage quota exceeded');
      },
    });

    const out = await deliverBriefToDrives(USER, { sections, now: NOW }, 'weekly', {
      store, providers: { google: provider },
    });

    expect(out).toEqual([{
      provider: 'google', status: 'failed', reason: 'Google Drive storage quota exceeded',
    }]);

    const view = (await store.view(USER))[0]!;
    expect(view.lastError).toBe('Google Drive storage quota exceeded');
    // A failed attempt is not an answer to "when did a brief last land".
    expect(view.lastUploadAt).toBeNull();
  });

  it('survives a provider that fails while finding the folder', async () => {
    const store = await connectedStore();
    const { provider } = fakeProvider({
      async ensureFolder() {
        throw new Error('Google Drive access was revoked — reconnect it in Newsletter settings');
      },
    });

    const out = await deliverBriefToDrives(USER, { sections, now: NOW }, 'weekly', {
      store, providers: { google: provider },
    });
    expect(out[0]!.status).toBe('failed');
    expect(out[0]!.reason).toMatch(/revoked/);
  });

  it('clears a previous failure once an upload succeeds again', async () => {
    const store = await connectedStore();
    const failing = fakeProvider({ async upload() { throw new Error('boom'); } });
    await deliverBriefToDrives(USER, { sections, now: NOW }, 'weekly', {
      store, providers: { google: failing.provider },
    });
    expect((await store.view(USER))[0]!.lastError).toBe('boom');

    const working = fakeProvider();
    const later = new Date('2026-09-16T08:00:00.000Z');
    await deliverBriefToDrives(USER, { sections, now: later }, 'weekly', {
      store, providers: { google: working.provider },
    });

    const view = (await store.view(USER))[0]!;
    expect(view.lastError).toBeNull();
    expect(view.lastUploadAt).toBe(later.toISOString());
  });

  it('names the cadence in the filename', async () => {
    const store = await connectedStore();
    const { provider, uploads } = fakeProvider();
    await deliverBriefToDrives(USER, { sections, now: NOW }, 'daily', { store, providers: { google: provider } });
    expect(uploads[0]!.filename).toBe('afisz-2026-09-09-daily.pdf');
  });
});

describe('normalizeDriveFolderName', () => {
  it('trims, and keeps the inner spacing a user typed', () => {
    expect(normalizeDriveFolderName('  Afisz briefs  ')).toBe('Afisz briefs');
  });

  it.each([
    ['empty', '   '],
    ['too long', 'x'.repeat(101)],
    ['a control character', 'Afisz\u0007ka'],
    ['a slash, which reads as a path', 'Afisz/briefs'],
  ])('rejects %s', (_label, name) => {
    expect(() => normalizeDriveFolderName(name)).toThrow();
  });

  it('accepts a name at exactly the limit', () => {
    expect(normalizeDriveFolderName('x'.repeat(100))).toHaveLength(100);
  });
});

describe('renameDriveFolder', () => {
  /** A connection that has already had its folder created in the drive. */
  async function withFolder() {
    const store = await connectedStore();
    await store.rememberFolder(USER, 'google', 'folder-1');
    return store;
  }

  it('renames the folder in the drive, then stores the name', async () => {
    const store = await withFolder();
    const { provider, renames } = fakeProvider();

    const out = await renameDriveFolder(USER, 'google', '  Briefs  ', {
      store, providers: { google: provider },
    });

    expect(out).toEqual({ folderName: 'Briefs', recreated: false });
    expect(renames).toEqual([{ folderId: 'folder-1', name: 'Briefs' }]);
    const view = (await store.view(USER))[0]!;
    expect(view.folderName).toBe('Briefs');
    // Same folder, so the cached id still holds — the briefs already in it
    // must not be stranded behind a second folder.
    expect(view.folderId).toBe('folder-1');
  });

  /**
   * The stored name is a promise about what the user will find in their drive.
   * If the drive refused the rename, keeping the old name is the honest state.
   */
  it('does not store the name when the drive refuses the rename', async () => {
    const store = await withFolder();
    const { provider } = fakeProvider({
      async renameFolder() {
        throw new Error('Renaming the Google Drive folder failed (HTTP 403)');
      },
    });

    await expect(
      renameDriveFolder(USER, 'google', 'Briefs', { store, providers: { google: provider } }),
    ).rejects.toThrow('HTTP 403');

    expect((await store.view(USER))[0]!.folderName).toBe(DEFAULT_DRIVE_FOLDER);
  });

  /**
   * `ensureFolder` re-verifies that a cached id is live but never that it still
   * carries the expected name, so a new name against a surviving stale id would
   * leave the UI promising one folder while briefs landed in another.
   */
  it('forgets the folder id when the folder is gone, so the next send recreates it', async () => {
    const store = await withFolder();
    const { provider } = fakeProvider({
      async renameFolder() {
        throw new DriveFolderMissingError();
      },
    });

    const out = await renameDriveFolder(USER, 'google', 'Briefs', {
      store, providers: { google: provider },
    });

    expect(out).toEqual({ folderName: 'Briefs', recreated: true });
    const view = (await store.view(USER))[0]!;
    expect(view.folderName).toBe('Briefs');
    expect(view.folderId).toBeNull();
  });

  it('stores the name without calling the drive when no folder exists yet', async () => {
    const store = await connectedStore();
    const { provider, renames } = fakeProvider();

    const out = await renameDriveFolder(USER, 'google', 'Briefs', {
      store, providers: { google: provider },
    });

    expect(out).toEqual({ folderName: 'Briefs', recreated: true });
    expect(renames).toHaveLength(0);
    expect((await store.view(USER))[0]!.folderName).toBe('Briefs');
  });

  it('is a no-op when the name is unchanged, so saving twice costs no API call', async () => {
    const store = await withFolder();
    const { provider, renames } = fakeProvider();

    const out = await renameDriveFolder(USER, 'google', `  ${DEFAULT_DRIVE_FOLDER}  `, {
      store, providers: { google: provider },
    });

    expect(out).toEqual({ folderName: DEFAULT_DRIVE_FOLDER, recreated: false });
    expect(renames).toHaveLength(0);
  });

  it('rejects an invalid name before touching the drive', async () => {
    const store = await withFolder();
    const { provider, renames } = fakeProvider();

    await expect(
      renameDriveFolder(USER, 'google', '   ', { store, providers: { google: provider } }),
    ).rejects.toThrow('cannot be empty');
    expect(renames).toHaveLength(0);
  });

  it('refuses when no drive is connected', async () => {
    const { provider } = fakeProvider();
    await expect(
      renameDriveFolder(USER, 'google', 'Briefs', {
        store: new InMemoryDriveStore(), providers: { google: provider },
      }),
    ).rejects.toThrow('No drive is connected.');
  });
});

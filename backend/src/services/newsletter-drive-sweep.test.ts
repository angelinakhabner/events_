import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Event } from '@afisz/shared';

/**
 * The seam between the send sweep and the drive copy (GOI-91).
 *
 * In its own file because it mocks the email transport: the rest of
 * `newsletter.test.ts` exercises the sweep through `dryRun`, which returns
 * before anything is sent, and these cases need a real send to reach the drive
 * step at all.
 */
const sendEmail = vi.fn(async () => ({ id: 'mail-1' }));
vi.mock('./email.js', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...(args as [])),
  newsletterFromEmail: () => 'newsletter@afisz.cc',
}));

const { sendNewsletterBriefs } = await import('./newsletter.js');
const { InMemoryNewsletterStore } = await import('./newsletter-store.js');
const { InMemoryUserVenueStore } = await import('./user-venue-store.js');
const { InMemoryDriveStore } = await import('./drive-store.js');
type DriveProvider = import('./cloud-drive.js').DriveProvider;

const NOW = new Date('2026-07-22T06:00:00Z'); // 08:00 Warsaw, the default slot.

const venue = (id: string, name: string) => ({
  id, name, url: `https://example.com/${id}`, city: 'Warsaw', country: 'PL',
  category: 'cinema' as const, language: 'pl', timezone: 'Europe/Warsaw',
  createdAt: NOW.toISOString(),
});

const event = (over: Partial<Event> = {}): Event =>
  ({
    id: 'e1', venueId: 'v1', title: 'Zimna wojna', description: null,
    startsAt: '2026-07-22T18:00:00.000Z', endsAt: null, kind: 'timed',
    category: 'cinema', language: 'pl', director: null, cast: [],
    durationMinutes: null, priceMin: null, priceMax: null,
    sourceUrl: 'https://example.com/film', sourceId: null,
    venue: { id: 'v1', name: 'Kinoteka', city: 'Warsaw' },
    ...over,
  }) as unknown as Event;

async function setup() {
  const store = new InMemoryNewsletterStore();
  await store.save('u1', {
    email: 'ada@example.com', sendCadence: 'daily', venueIds: ['v1'],
    sendHour: 8, enabled: true,
    // Every case here is about the filed copy, which since the delivery
    // choice is something a reader asks for rather than something a connected
    // drive implies. `both` is what "a subscriber who connected a drive" used
    // to mean on its own.
    delivery: 'both',
  });
  const venues = new InMemoryUserVenueStore([venue('v1', 'Kinoteka')]);
  await venues.ensureSeeded('u1');
  return {
    store,
    deps: {
      venues,
      events: { listUpcoming: async () => [event()] },
      // Injected for the same reason `venues` and `events` are: without it the
      // sweep reaches for the process-wide store, and the test's behaviour
      // starts depending on whether DATABASE_URL happens to be set (GOI-101).
      wantToGo: { list: async () => [] },
      // …and the tracked titles beside them (GOI-112), for the same reason.
      films: { list: async () => [] },
    },
  };
}

function fakeProvider(over: Partial<DriveProvider> = {}) {
  const uploads: { filename: string; bytes: number }[] = [];
  const provider = {
    id: 'google' as const,
    label: 'Google Drive',
    async ensureFolder() { return { folderId: 'folder-1', created: false }; },
    async upload({ file }: { file: { filename: string; body: Buffer } }) {
      uploads.push({ filename: file.filename, bytes: file.body.length });
      return { fileId: 'f1', webUrl: 'https://drive.google.com/file/d/f1' };
    },
    ...over,
  } as unknown as DriveProvider;
  return { provider, uploads };
}

beforeEach(() => {
  sendEmail.mockClear();
});

describe('the sweep and the drive copy', () => {
  it('files a PDF for a subscriber who connected a drive', async () => {
    const { store, deps } = await setup();
    const drives = new InMemoryDriveStore();
    await drives.connect('u1', { provider: 'google', refreshToken: 'rt', accountEmail: 'ada@example.com' });
    const { provider, uploads } = fakeProvider();

    const res = await sendNewsletterBriefs(store, NOW, {
      ...deps,
      drive: { store: drives, providers: { google: provider } },
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(res.sent).toBe(1);
    expect(uploads).toEqual([
      { filename: 'afisz-2026-07-22-daily.pdf', bytes: expect.any(Number) },
    ]);
    expect(uploads[0]!.bytes).toBeGreaterThan(1000);
    expect(res.outcomes[0]!.drives).toEqual([
      expect.objectContaining({ provider: 'google', status: 'uploaded' }),
    ]);
  });

  it('leaves the outcome clean for the many subscribers with no drive', async () => {
    const { store, deps } = await setup();
    const { provider, uploads } = fakeProvider();

    const res = await sendNewsletterBriefs(store, NOW, {
      ...deps,
      drive: { store: new InMemoryDriveStore(), providers: { google: provider } },
    });

    expect(res.sent).toBe(1);
    expect(uploads).toHaveLength(0);
    expect(res.outcomes[0]!.drives).toBeUndefined();
  });

  /**
   * The property the whole ordering exists to protect: the email is the
   * product. A drive that is full, revoked or down must not turn a brief the
   * subscriber has already received into a failed send, nor leave it unmarked
   * so the next sweep mails it again.
   */
  it('still counts the brief as sent when the drive upload fails', async () => {
    const { store, deps } = await setup();
    const drives = new InMemoryDriveStore();
    await drives.connect('u1', { provider: 'google', refreshToken: 'rt', accountEmail: null });
    const { provider } = fakeProvider({
      async upload() { throw new Error('storage quota exceeded'); },
    });

    const res = await sendNewsletterBriefs(store, NOW, {
      ...deps,
      drive: { store: drives, providers: { google: provider } },
    });

    expect(res.sent).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.outcomes[0]!.status).toBe('sent');
    expect(res.outcomes[0]!.drives).toEqual([
      expect.objectContaining({ status: 'failed', reason: 'storage quota exceeded' }),
    ]);
    // Marked sent, so the next sweep will not email it a second time.
    expect((await store.get('u1'))!.lastSentAt).toBe(NOW.toISOString());
    // And the failure is on the connection, where the UI shows it.
    expect((await drives.view('u1'))[0]!.lastError).toBe('storage quota exceeded');
  });

  it('skipDrives sends the email and files nothing', async () => {
    const { store, deps } = await setup();
    const drives = new InMemoryDriveStore();
    await drives.connect('u1', { provider: 'google', refreshToken: 'rt', accountEmail: null });
    const { provider, uploads } = fakeProvider();

    const res = await sendNewsletterBriefs(store, NOW, {
      ...deps,
      skipDrives: true,
      drive: { store: drives, providers: { google: provider } },
    });

    expect(res.sent).toBe(1);
    expect(uploads).toHaveLength(0);
  });

  it('files nothing on a dry run', async () => {
    const { store, deps } = await setup();
    const drives = new InMemoryDriveStore();
    await drives.connect('u1', { provider: 'google', refreshToken: 'rt', accountEmail: null });
    const { provider, uploads } = fakeProvider();

    const res = await sendNewsletterBriefs(store, NOW, {
      ...deps,
      dryRun: true,
      drive: { store: drives, providers: { google: provider } },
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
    expect(res.outcomes[0]!.detail).toContain('dry run');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Event } from '@afisz/shared';

/**
 * Where a brief goes: an email, a PDF filed on a connected drive, or both.
 *
 * In its own file, and mocking the mail transport, for the same reason
 * `newsletter-drive-sweep.test.ts` is: the rest of the sweep's tests run under
 * `dryRun`, which returns before anything is delivered, and these cases are
 * entirely about what happens at delivery.
 *
 * Filing to a drive (GOI-91) used to be an *addition* to the email, and the
 * code was written on that assumption — `deliverBriefToDrives` never throws,
 * because a full drive must not turn a brief that was successfully emailed
 * into a failed send. For a reader who chose `drive` that reasoning does not
 * hold: there is no email, so the filed PDF is the delivery. Most of what
 * follows is about that difference.
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
const { deliversByEmail, deliversToDrive } = await import('@afisz/shared');
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

async function setup(delivery: 'email' | 'drive' | 'both') {
  const store = new InMemoryNewsletterStore();
  await store.save('u1', {
    email: 'ada@example.com', sendCadence: 'daily', venueIds: ['v1'],
    sendHour: 8, delivery, enabled: true,
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
      // starts depending on whether DATABASE_URL happens to be set (GOI-101,
      // and the tracked titles beside them since GOI-112).
      wantToGo: { list: async () => [] },
      films: { list: async () => [] },
    },
  };
}

function fakeProvider(over: Partial<DriveProvider> = {}) {
  const uploads: string[] = [];
  const provider = {
    id: 'google' as const,
    label: 'Google Drive',
    async ensureFolder() { return { folderId: 'folder-1', created: false }; },
    async upload({ file }: { file: { filename: string; body: Buffer } }) {
      uploads.push(file.filename);
      return { fileId: 'f1', webUrl: 'https://drive.google.com/file/d/f1' };
    },
    ...over,
  } as unknown as DriveProvider;
  return { provider, uploads };
}

/** A drive store with one Google connection on it. */
async function connectedDrive() {
  const drives = new InMemoryDriveStore();
  await drives.connect('u1', { provider: 'google', refreshToken: 'rt', accountEmail: null });
  return drives;
}

beforeEach(() => sendEmail.mockClear());

describe('deliversByEmail / deliversToDrive', () => {
  it('read the choice the way the sweep does', () => {
    expect(deliversByEmail('email')).toBe(true);
    expect(deliversByEmail('both')).toBe(true);
    expect(deliversByEmail('drive')).toBe(false);

    expect(deliversToDrive('drive')).toBe(true);
    expect(deliversToDrive('both')).toBe(true);
    expect(deliversToDrive('email')).toBe(false);
  });
});

describe('the delivery choice', () => {
  it('defaults to email, which is what every existing config already was', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await store.save('u1', {
      email: 'a@b.pl', sendCadence: 'daily', venueIds: [], enabled: true,
    });
    expect(saved.delivery).toBe('email');
  });

  /**
   * A connected drive is not a request. Before this choice existed it was
   * treated as one — connecting a drive silently started filing copies — and
   * for someone who wanted only the email that was a file they never asked for.
   */
  it('emails and files nothing when set to email, even with a drive connected', async () => {
    const { store, deps } = await setup('email');
    const { provider, uploads } = fakeProvider();

    const res = await sendNewsletterBriefs(store, NOW, {
      ...deps,
      drive: { store: await connectedDrive(), providers: { google: provider } },
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(uploads).toEqual([]);
    expect(res.outcomes[0]).toMatchObject({ status: 'sent' });
    expect(res.outcomes[0]!.drives).toBeUndefined();
  });

  it('files and sends no email when set to drive', async () => {
    const { store, deps } = await setup('drive');
    const { provider, uploads } = fakeProvider();

    const res = await sendNewsletterBriefs(store, NOW, {
      ...deps,
      drive: { store: await connectedDrive(), providers: { google: provider } },
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(uploads).toEqual(['afisz-2026-07-22-daily.pdf']);
    expect(res.outcomes[0]).toMatchObject({ status: 'sent' });
    expect(res.outcomes[0]!.drives).toEqual([
      expect.objectContaining({ provider: 'google', status: 'uploaded' }),
    ]);
  });

  it('does both when set to both', async () => {
    const { store, deps } = await setup('both');
    const { provider, uploads } = fakeProvider();

    const res = await sendNewsletterBriefs(store, NOW, {
      ...deps,
      drive: { store: await connectedDrive(), providers: { google: provider } },
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(uploads).toHaveLength(1);
    expect(res.outcomes[0]!.drives).toEqual([
      expect.objectContaining({ status: 'uploaded' }),
    ]);
  });
});

/**
 * The half that matters. With no email to fall back on, a drive that refuses
 * the brief means the reader got nothing — so it cannot be reported as a send,
 * and above all the issue must not be stamped as delivered.
 */
describe('a drive-only newsletter that could not be filed', () => {
  it('is skipped, not sent, when no drive is connected', async () => {
    const { store, deps } = await setup('drive');
    const { provider } = fakeProvider();

    const res = await sendNewsletterBriefs(store, NOW, {
      ...deps,
      drive: { store: new InMemoryDriveStore(), providers: { google: provider } },
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(res.outcomes[0]).toMatchObject({ status: 'skipped', reason: 'no-drive' });
    expect(res.sent).toBe(0);
  });

  it('leaves the issue unstamped, so the next sweep tries again', async () => {
    const { store, deps } = await setup('drive');

    await sendNewsletterBriefs(store, NOW, {
      ...deps,
      drive: { store: new InMemoryDriveStore(), providers: { google: fakeProvider().provider } },
    });
    expect((await store.get('u1'))!.lastSentAt).toBeNull();

    // And once a drive appears, the same issue goes out.
    const res = await sendNewsletterBriefs(store, NOW, {
      ...deps,
      drive: { store: await connectedDrive(), providers: { google: fakeProvider().provider } },
    });
    expect(res.outcomes[0]).toMatchObject({ status: 'sent' });
    expect((await store.get('u1'))!.lastSentAt).toBe(NOW.toISOString());
  });

  it('is a failure when every drive refuses it', async () => {
    const { store, deps } = await setup('drive');
    const { provider } = fakeProvider({
      async upload() { throw new Error('storage quota exceeded'); },
    });

    const res = await sendNewsletterBriefs(store, NOW, {
      ...deps,
      drive: { store: await connectedDrive(), providers: { google: provider } },
    });

    expect(res.outcomes[0]).toMatchObject({ status: 'failed', reason: 'send-failed' });
    expect(res.outcomes[0]!.detail).toMatch(/storage quota exceeded/i);
    expect(res.failed).toBe(1);
    expect((await store.get('u1'))!.lastSentAt).toBeNull();
  });

  /**
   * The contrast that justifies the branch, and the property the original
   * ordering exists to protect. For `both` the email is the product: the
   * reader has the brief, so re-sending it tomorrow because the drive was full
   * would be wrong.
   */
  it('but a failed upload on "both" is still a send, since the email arrived', async () => {
    const { store, deps } = await setup('both');
    const { provider } = fakeProvider({
      async upload() { throw new Error('storage quota exceeded'); },
    });

    const res = await sendNewsletterBriefs(store, NOW, {
      ...deps,
      drive: { store: await connectedDrive(), providers: { google: provider } },
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(res.outcomes[0]).toMatchObject({ status: 'sent' });
    expect((await store.get('u1'))!.lastSentAt).toBe(NOW.toISOString());
  });
});

/** `skipDrives` is for a caller that wants the email and nothing else. It must
 *  not silently turn a drive-only newsletter into a send that never happened. */
describe('skipDrives', () => {
  it('leaves a drive-only newsletter unsent rather than pretending', async () => {
    const { store, deps } = await setup('drive');

    const res = await sendNewsletterBriefs(store, NOW, { ...deps, skipDrives: true });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(res.outcomes[0]).toMatchObject({ status: 'skipped', reason: 'no-drive' });
    expect((await store.get('u1'))!.lastSentAt).toBeNull();
  });
});

/**
 * The dedup states behind the saved-events queue (GOI-101) are consumed by a
 * *delivery*, not by an attempt. A drive-only issue that was never filed must
 * leave them alone, or the reader is never told and the next issue skips what
 * it believes it already said.
 */
describe('the saved-events queue under a drive-only newsletter', () => {
  it('does not consume its dedup states when nothing was filed', async () => {
    const { store, deps } = await setup('drive');
    const saved = (await store.get('u1'))!;
    const spy = vi.spyOn(store, 'recordSent');

    await sendNewsletterBriefs(store, NOW, {
      ...deps,
      wantToGo: {
        list: async () => [event({ id: 'saved', startsAt: '2026-07-23T18:00:00.000Z' })],
      },
      drive: { store: new InMemoryDriveStore(), providers: { google: fakeProvider().provider } },
    });

    expect(spy).not.toHaveBeenCalled();
    expect(await store.sentStates(saved.id, 'tomorrow', ['saved'])).toEqual(new Set());
  });
});

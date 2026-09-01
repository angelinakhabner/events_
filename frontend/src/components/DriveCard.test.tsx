/**
 * "Save briefs to a drive", with more than one drive to save to (GOI-93).
 *
 * The card was written when Google was the only provider and said so in three
 * places. These cases pin the part that had to change: it now draws a block
 * per provider the deployment offers, each carrying its own connection state,
 * and every action names the provider it belongs to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const statusMock = vi.fn();
const connectMutate = vi.fn();
const disconnectMutate = vi.fn();
const renameMutate = vi.fn();

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      my: { newsletter: { drive: { status: { invalidate: vi.fn() } } } },
    }),
    my: {
      newsletter: {
        drive: {
          status: { useQuery: () => statusMock() },
          connectUrl: {
            useMutation: () => ({ mutate: connectMutate, isPending: false }),
          },
          disconnect: {
            useMutation: () => ({ mutate: disconnectMutate, isPending: false }),
          },
          setFolderName: {
            useMutation: () => ({ mutate: renameMutate, isPending: false }),
          },
        },
      },
    },
  },
}));

const { DriveCard } = await import('./NewsletterSection');

const GOOGLE = { id: 'google', label: 'Google Drive' };
const DROPBOX = { id: 'dropbox', label: 'Dropbox' };

function connection(over: Record<string, unknown> = {}) {
  return {
    provider: 'google',
    accountEmail: 'ania@example.com',
    folderName: 'Afisz.ka',
    folderId: 'f-1',
    connectedAt: '2026-08-01T00:00:00.000Z',
    lastUploadAt: null,
    lastError: null,
    ...over,
  };
}

function ready(data: unknown) {
  statusMock.mockReturnValue({ data, isLoading: false, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DriveCard (GOI-93)', () => {
  it('offers a connect button per configured provider', () => {
    ready({ available: true, providers: [GOOGLE, DROPBOX], connections: [] });
    render(<DriveCard />);

    expect(screen.getByRole('button', { name: 'Connect Google Drive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Dropbox' })).toBeInTheDocument();
  });

  /** A deployment with only Dropbox credentials must not advertise Google. */
  it('offers only what the deployment is configured for', () => {
    ready({ available: true, providers: [DROPBOX], connections: [] });
    render(<DriveCard />);

    expect(screen.getByRole('button', { name: 'Connect Dropbox' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();
  });

  it('says nothing is available when no drive is configured', () => {
    ready({ available: false, providers: [], connections: [] });
    render(<DriveCard />);

    expect(screen.getByText(/no drive is configured/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect/ })).not.toBeInTheDocument();
  });

  /**
   * Both at once is a supported setup, not an edge case: the sweep uploads to
   * every connection it finds, so the card has to show each one's own account,
   * folder and last error rather than collapsing them.
   */
  it('shows each connection separately when both are connected', () => {
    ready({
      available: true,
      providers: [GOOGLE, DROPBOX],
      connections: [
        connection({ provider: 'google', accountEmail: 'ania@gmail.com' }),
        connection({
          provider: 'dropbox',
          accountEmail: 'ania@dropbox.com',
          folderName: 'Briefs',
          lastError: 'Uploading the brief to Dropbox failed (HTTP 507)',
        }),
      ],
    });
    render(<DriveCard />);

    expect(screen.getByText(/Google Drive connected — ania@gmail\.com/)).toBeInTheDocument();
    expect(screen.getByText(/Dropbox connected — ania@dropbox\.com/)).toBeInTheDocument();
    // The failure is reported against the drive it happened on, not both.
    expect(screen.getByText(/HTTP 507/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Connect / })).not.toBeInTheDocument();
  });

  it('names the provider when connecting, disconnecting and renaming', async () => {
    const user = userEvent.setup();
    ready({
      available: true,
      providers: [GOOGLE, DROPBOX],
      connections: [connection({ provider: 'dropbox', folderName: 'Briefs' })],
    });
    render(<DriveCard />);

    await user.click(screen.getByRole('button', { name: 'Connect Google Drive' }));
    expect(connectMutate).toHaveBeenCalledWith({ provider: 'google' });

    const dropboxBlock = screen.getByText(/Dropbox connected/).closest('div')!;
    await user.click(within(dropboxBlock).getByRole('button', { name: 'Disconnect' }));
    expect(disconnectMutate).toHaveBeenCalledWith({ provider: 'dropbox' });

    // The rename has to carry the provider too — the folder name is per
    // connection, and sending it without one would rename Google's folder.
    const field = within(dropboxBlock).getByLabelText(/folder/i);
    await user.clear(field);
    await user.type(field, 'Wrzesień');
    await user.click(within(dropboxBlock).getByRole('button', { name: /save/i }));
    expect(renameMutate).toHaveBeenCalledWith({ provider: 'dropbox', folderName: 'Wrzesień' });
  });

  /**
   * The GOI-105 lesson, applied here before it can bite: an API built before
   * GOI-93 sends no `providers`. Falling back to Google keeps the card working
   * rather than drawing a heading with nothing under it.
   */
  it('falls back to Google against an API that does not send providers', () => {
    ready({ available: true, connections: [] });
    render(<DriveCard />);

    expect(screen.getByRole('button', { name: 'Connect Google Drive' })).toBeInTheDocument();
  });
});

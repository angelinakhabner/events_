/**
 * End-to-end-ish: mounts MyFoldersPage and drives the real "New folder"
 * flow against a real Hono backend, in-process. No mocking of the tRPC
 * client. Catches the user-reported "modal stays open, nothing happens"
 * regression.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { MemoryRouter } from 'react-router-dom';
import { createApp } from '../../../backend/src/app';
import { trpc, makeQueryClient } from '../lib/trpc';
import { MyFoldersPage } from './MyFolders';

const DEVICE = 'e2e-device-' + Math.random().toString(16).slice(2);

// In-process fetch — route every request through the Hono app instead of
// the network. Matches what httpBatchLink expects.
function inProcessFetch(app: ReturnType<typeof createApp>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    const full = url.startsWith('http') ? url : `http://local${url}`;
    return app.request(full, init);
  }) as typeof fetch;
}

function renderPage() {
  const app = createApp();
  const queryClient = makeQueryClient();
  const trpcClient = trpc.createClient({
    links: [
      httpBatchLink({
        url: 'http://local/trpc',
        fetch: inProcessFetch(app),
        headers() { return { 'x-device-id': DEVICE }; },
      }),
    ],
  });
  return render(
    <MemoryRouter>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <MyFoldersPage />
        </QueryClientProvider>
      </trpc.Provider>
    </MemoryRouter>,
  );
}

describe('MyFoldersPage — end-to-end create flow', () => {
  beforeEach(() => {
    // Reset the in-memory folder store between tests (no DATABASE_URL here).
    // Done by importing fresh — the store is module-scoped, so a require
    // bust isn't trivial. We use unique device IDs above instead.
  });

  it('clicking New folder → Create folder creates the folder, closes the modal, and shows it in the list', async () => {
    renderPage();
    // Wait for initial listMine to resolve (empty state).
    await waitFor(() => expect(screen.getByText(/you.+have any folders yet/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^new folder$/i }));

    // Modal is open
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/name/i), 'My e2e folder');
    await userEvent.click(screen.getByRole('button', { name: /create folder/i }));

    // Modal should close
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Folder appears in the list
    expect(await screen.findByText('My e2e folder')).toBeInTheDocument();
  });
});

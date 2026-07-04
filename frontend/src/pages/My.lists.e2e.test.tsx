/**
 * End-to-end-ish: mounts MyPage logged in against a real Hono backend,
 * in-process, and drives the lists flow — seeded "Warsaw" list is active,
 * creating "Poznan", switching to it, and seeing the venue list re-scope.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { MemoryRouter } from 'react-router-dom';
import { createApp } from '../../../backend/src/app';
import { defaultAuthStore, requestMagicLink, verifyMagicLink } from '../../../backend/src/services/auth';
import { trpc, makeQueryClient } from '../lib/trpc';
import { setSessionToken, getSessionToken } from '../lib/auth';
import { MyPage } from './My';

const DEVICE = 'e2e-lists-device';

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
        headers() {
          const token = getSessionToken();
          return {
            'x-device-id': DEVICE,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          };
        },
      }),
    ],
  });
  return render(
    <MemoryRouter>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <MyPage />
        </QueryClientProvider>
      </trpc.Provider>
    </MemoryRouter>,
  );
}

beforeAll(async () => {
  const { token } = await requestMagicLink(defaultAuthStore, 'lists-e2e@example.com');
  const verified = await verifyMagicLink(defaultAuthStore, token);
  if (!verified) throw new Error('login failed');
  setSessionToken(verified.sessionToken);
});

describe('MyPage — lists end-to-end', () => {
  it('shows the seeded Warsaw list, creates Poznan, and switching re-scopes the venues', async () => {
    renderPage();

    // Seeded state: an active "Warsaw" tab and at least one default venue.
    const warsawTab = await screen.findByRole('button', { name: /warsaw/i });
    await waitFor(() => expect(warsawTab).toHaveAttribute('aria-pressed', 'true'));
    expect(await screen.findByText('Kinoteka')).toBeInTheDocument();

    // Create a second list.
    await userEvent.click(screen.getByRole('button', { name: /\+ new list/i }));
    await userEvent.type(screen.getByLabelText(/list name/i), 'Poznan');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    const poznanTab = await screen.findByRole('button', { name: /poznan/i });
    expect(poznanTab).toHaveAttribute('aria-pressed', 'false');

    // Switch to it: it becomes active and the venue list is empty.
    await userEvent.click(poznanTab);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /poznan/i })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(await screen.findByText(/no venues in this list yet/i)).toBeInTheDocument();
    expect(screen.queryByText('Kinoteka')).not.toBeInTheDocument();

    // Switch back: the Warsaw venues return.
    await userEvent.click(screen.getByRole('button', { name: /warsaw/i }));
    expect(await screen.findByText('Kinoteka')).toBeInTheDocument();
  });
});

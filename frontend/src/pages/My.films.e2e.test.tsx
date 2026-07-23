/**
 * End-to-end-ish: mounts MyPage logged in against a real Hono backend,
 * in-process, and drives the films flow (GOI-5) — adding a title to
 * "Want to watch", marking it seen with a venue + comment, and moving it back.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { MemoryRouter } from 'react-router-dom';
import { createApp } from '../../../backend/src/app';
import { defaultAuthStore, requestMagicLink, verifyMagicLink } from '../../../backend/src/services/auth';
import { trpc, makeQueryClient } from '../lib/trpc';
import { setSessionToken, getSessionToken } from '../lib/auth';
import { MyPage } from './My';

const DEVICE = 'e2e-films-device';

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
  const { token } = await requestMagicLink(defaultAuthStore, 'films-e2e@example.com');
  const verified = await verifyMagicLink(defaultAuthStore, token);
  if (!verified) throw new Error('login failed');
  setSessionToken(verified.sessionToken);
});

describe('MyPage — films end-to-end', () => {
  it('adds a film, marks it seen with venue + comment, and moves it back', async () => {
    const user = userEvent.setup();
    renderPage();

    const section = (await screen.findByRole('heading', { name: 'Films' })).closest('section')!;

    // Add a title to the want list.
    await user.type(within(section).getByLabelText(/film title/i), 'Perfect Days');
    await user.click(within(section).getByRole('button', { name: /add film/i }));
    await within(section).findByText('Perfect Days');
    expect(within(section).getByRole('tab', { name: /want to watch \(1\)/i })).toBeInTheDocument();

    // Mark it seen with where + a short note.
    await user.click(within(section).getByRole('button', { name: /seen it/i }));
    await user.type(within(section).getByLabelText(/where did you watch/i), 'Kino Muranów');
    await user.type(within(section).getByLabelText(/short comment/i), 'Quiet and lovely');
    await user.click(within(section).getByRole('button', { name: /move to seen/i }));

    // The want tab empties; the seen tab holds the film with its details.
    await waitFor(() =>
      expect(within(section).getByRole('tab', { name: /seen \(1\)/i })).toBeInTheDocument(),
    );
    await user.click(within(section).getByRole('tab', { name: /seen \(1\)/i }));
    await within(section).findByText('Perfect Days');
    expect(within(section).getByText(/at Kino Muranów/)).toBeInTheDocument();
    expect(within(section).getByText('Quiet and lovely')).toBeInTheDocument();

    // Move it back to the want list.
    await user.click(within(section).getByRole('button', { name: /back to want/i }));
    await waitFor(() =>
      expect(within(section).getByRole('tab', { name: /want to watch \(1\)/i })).toBeInTheDocument(),
    );
  });

  it('rejects a duplicate title with a friendly message', async () => {
    const user = userEvent.setup();
    renderPage();

    const section = (await screen.findByRole('heading', { name: 'Films' })).closest('section')!;
    const input = within(section).getByLabelText(/film title/i);

    await user.type(input, 'Dune');
    await user.click(within(section).getByRole('button', { name: /add film/i }));
    await within(section).findByText('Dune');

    await user.type(input, 'dune');
    await user.click(within(section).getByRole('button', { name: /add film/i }));
    await within(section).findByText(/already have/i);
  });
});

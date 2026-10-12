/**
 * End-to-end-ish: mounts MyPage logged in against a real Hono backend,
 * in-process, and drives the "My venues" tab (GOI-25) — the seeded "Warsaw"
 * folder is active and lists its venues, a second folder can be created,
 * venues can be moved between folders, and a venue can be tagged.
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

// Fresh identity per run — see the note in My.wanttogo.e2e.test.tsx: the CI
// Postgres outlives the process, so a fixed account carries state between runs.
const RUN = Math.random().toString(36).slice(2, 10);
const DEVICE = `e2e-venues-device-${RUN}`;
const USER_EMAIL = `venues-e2e-${RUN}@example.com`;

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

/** Open the "My venues" section from the left-hand menu and return it. */
async function openVenues(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'My venues' }));
  return (await screen.findByRole('heading', { name: 'My venues' })).closest('section')!;
}

beforeAll(async () => {
  const { token } = await requestMagicLink(defaultAuthStore, USER_EMAIL);
  const verified = await verifyMagicLink(defaultAuthStore, token);
  if (!verified) throw new Error('login failed');
  setSessionToken(verified.sessionToken);
});

describe('MyPage — My venues end-to-end', () => {
  it('lists venues under the seeded folder, adds a folder, and moves a venue into it', async () => {
    const user = userEvent.setup();
    renderPage();
    const section = await openVenues(user);

    // Seeded state: an active "Warsaw" folder holding the default venues.
    const warsawTab = await within(section).findByRole('button', { name: /warsaw/i });
    await waitFor(() => expect(warsawTab).toHaveAttribute('aria-pressed', 'true'));
    expect(await within(section).findByText('Kinoteka')).toBeInTheDocument();

    // Create a second folder. Its (empty) section shows up straight away —
    // unlike the old lists UI, every folder is listed at once.
    await user.click(within(section).getByRole('button', { name: /\+ new folder/i }));
    await user.type(within(section).getByLabelText(/folder name/i), 'Poznan');
    await user.click(within(section).getByRole('button', { name: /^create$/i }));
    await within(section).findByText(/nothing filed here yet/i);

    // Move Kinoteka into Poznan. Its folder select only appears once there is
    // somewhere else to put it.
    const venueRow = within(section).getByText('Kinoteka').closest('li')!;
    await user.selectOptions(
      await within(venueRow).findByLabelText(/folder for kinoteka/i),
      'Poznan',
    );

    // Kinoteka is still on the page — it moved folder, it didn't disappear.
    await waitFor(() => {
      expect(within(section).queryByText(/nothing filed here yet/i)).not.toBeInTheDocument();
    });
    expect(within(section).getByText('Kinoteka')).toBeInTheDocument();
  });

  it('tags a venue and removes the tag again', async () => {
    const user = userEvent.setup();
    renderPage();
    const section = await openVenues(user);

    const venue = await within(section).findByText('Kino Muranów');
    const row = venue.closest('li')!;

    await user.click(within(row).getByRole('button', { name: /add tag to kino muranów/i }));
    await user.type(within(row).getByLabelText(/new tag for kino muranów/i), 'date night');
    await user.click(within(row).getByRole('button', { name: /^add$/i }));

    const tag = await within(section).findByText('date night');
    expect(tag).toBeInTheDocument();

    await user.click(
      within(section).getByRole('button', { name: /remove tag date night from kino muranów/i }),
    );
    await waitFor(() => expect(within(section).queryByText('date night')).not.toBeInTheDocument());
  });
});

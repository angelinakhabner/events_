/**
 * End-to-end-ish: mounts MyPage logged in against a real Hono backend,
 * in-process, and drives the "Want to go" tab (GOI-26) — one plain list, a
 * search across venues rather than a bare "add a film" field (GOI-112), and a
 * seen mark that files an entry under "Seen" rather than dropping it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { MemoryRouter } from 'react-router-dom';
import { createApp } from '../../../backend/src/app';
import { defaultAuthStore, requestMagicLink, verifyMagicLink } from '../../../backend/src/services/auth';
import { defaultFilmStore } from '../../../backend/src/services/film-store';
import { trpc, makeQueryClient } from '../lib/trpc';
import { setSessionToken, getSessionToken } from '../lib/auth';
import { MyPage } from './My';

// A fresh identity per run. These e2e tests drive the real backend, which in
// CI is backed by a Postgres that outlives the process — a fixed email meant
// the same user accumulated rows run over run, so the exact-count assertions
// below ("Want to go (1)") started failing against leftovers. Randomising
// the account keeps each run's state its own without needing a DB reset.
const RUN = Math.random().toString(36).slice(2, 10);
const DEVICE = `e2e-wanttogo-device-${RUN}`;
const USER_EMAIL = `wanttogo-e2e-${RUN}@example.com`;
let userId = '';

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

/** Open "Want to go" from the left-hand menu and return its section. */
async function openWantToGo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Want to go' }));
  return (await screen.findByRole('heading', { name: 'Want to go' })).closest('section')!;
}

beforeAll(async () => {
  const { token } = await requestMagicLink(defaultAuthStore, USER_EMAIL);
  const verified = await verifyMagicLink(defaultAuthStore, token);
  if (!verified) throw new Error('login failed');
  setSessionToken(verified.sessionToken);
  userId = verified.user.id;
});

describe('MyPage — want to go end-to-end', () => {
  /**
   * GOI-112 replaces the invariant this used to assert.
   *
   * The list had no way to type into it on purpose: a film arrived from a
   * screenings panel you could only open from a screening you had already
   * found. That is no help when the question is "is this on anywhere", and it
   * is the one question a want-to-go list is for — so there is a box now, and
   * it is a search rather than a text field, which is the distinction the old
   * test was really protecting.
   */
  it('takes a title as a search across venues, not as a bare text field', async () => {
    const user = userEvent.setup();
    renderPage();
    const section = await openWantToGo(user);

    await within(section).findByRole('tab', { name: /want to go \(0\)/i });
    expect(within(section).getByLabelText(/search across venues/i)).toBeInTheDocument();
    // Nothing is added by typing: the search answers first, and only when it
    // finds nothing does the title itself go on the list.
    expect(within(section).getByRole('button', { name: /^search$/i })).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();
  });

  it('marks a tracked film seen with venue + comment, then moves it back', async () => {
    const user = userEvent.setup();
    // Seeded the way the search's "nothing on" branch would add it, so this
    // test stays about the seen/unseen round trip rather than the search.
    await defaultFilmStore.add(userId, 'Perfect Days');

    renderPage();
    const section = await openWantToGo(user);

    await within(section).findByText('Perfect Days');
    expect(within(section).getByRole('tab', { name: /want to go \(1\)/i })).toBeInTheDocument();

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
    await user.click(within(section).getByRole('button', { name: /not seen/i }));
    await waitFor(() =>
      expect(within(section).getByRole('tab', { name: /want to go \(1\)/i })).toBeInTheDocument(),
    );
  });
});

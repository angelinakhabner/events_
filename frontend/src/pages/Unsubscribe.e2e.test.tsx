/**
 * GOI-35 — the brief's unsubscribe link lands here with a token and no
 * session. Runs against the real backend router in-process (as the auth
 * tests do), so the tRPC procedure's public-ness is genuinely exercised: a
 * userProcedure would fail these with UNAUTHORIZED.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createApp } from '../../../backend/src/app';
import { defaultNewsletterStore } from '../../../backend/src/services/newsletter-store';
import { trpc, makeQueryClient } from '../lib/trpc';
import { UnsubscribePage } from './Unsubscribe';

function inProcessFetch(app: ReturnType<typeof createApp>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    const full = url.startsWith('http') ? url : `http://local${url}`;
    return app.request(full, init);
  }) as typeof fetch;
}

function renderAt(path: string) {
  const queryClient = makeQueryClient();
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: 'http://local/trpc', fetch: inProcessFetch(createApp()) })],
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/unsubscribe" element={<UnsubscribePage />} />
            <Route path="/" element={<p>home stub</p>} />
            <Route path="/my" element={<p>my page stub</p>} />
          </Routes>
        </QueryClientProvider>
      </trpc.Provider>
    </MemoryRouter>,
  );
}

/** Seed a subscription and hand back its unsubscribe token. */
async function seed(userId: string, email: string): Promise<string> {
  await defaultNewsletterStore.save(userId, {
    email,
    frequency: 'daily',
    venueIds: [],
    enabled: true,
  });
  const subs = await defaultNewsletterStore.listEnabled();
  return subs.find((s) => s.userId === userId)!.unsubscribeToken;
}

describe('UnsubscribePage', () => {
  it('turns the brief off with only the token — no sign-in', async () => {
    const token = await seed('u-off', 'reader@example.com');
    renderAt(`/unsubscribe?token=${encodeURIComponent(token)}`);

    expect(await screen.findByText(/no more briefs/i)).toBeInTheDocument();
    expect(screen.getByText('reader@example.com')).toBeInTheDocument();
    expect((await defaultNewsletterStore.get('u-off'))?.enabled).toBe(false);
  });

  it('offers a way back for an accidental click', async () => {
    const token = await seed('u-back', 'oops@example.com');
    renderAt(`/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(await screen.findByRole('link', { name: /turn it back on/i })).toBeInTheDocument();
  });

  it('reads a second visit as "already off", not a failure', async () => {
    const token = await seed('u-twice', 'again@example.com');
    await defaultNewsletterStore.unsubscribeByToken(token);
    renderAt(`/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(await screen.findByText(/already off/i)).toBeInTheDocument();
  });

  it('explains a truncated or bogus token instead of claiming success', async () => {
    renderAt('/unsubscribe?token=not-a-real-token');
    expect(await screen.findByText(/isn.t valid/i)).toBeInTheDocument();
  });

  it('handles a link with no token at all', async () => {
    renderAt('/unsubscribe');
    expect(await screen.findByText(/isn.t valid/i)).toBeInTheDocument();
  });

  it('trusts the backend redirect and does not re-run the mutation', async () => {
    // The API's GET route already did the work, then redirected here with
    // ?status=. Re-firing the mutation would be a pointless second write.
    const token = await seed('u-redirect', 'redirect@example.com');
    renderAt('/unsubscribe?status=unsubscribed');
    expect(await screen.findByText(/no more briefs/i)).toBeInTheDocument();

    // Still on, because this render never called the mutation.
    const subs = await defaultNewsletterStore.listEnabled();
    expect(subs.some((s) => s.unsubscribeToken === token)).toBe(true);
  });

  it('never leaks the token into the page', async () => {
    const token = await seed('u-leak', 'quiet@example.com');
    const { container } = renderAt(`/unsubscribe?token=${encodeURIComponent(token)}`);
    await waitFor(() => expect(screen.getByText(/no more briefs/i)).toBeInTheDocument());
    expect(container.innerHTML).not.toContain(token);
  });
});

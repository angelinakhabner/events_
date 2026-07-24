/**
 * OAuth (Google) landing: the backend puts the minted session (or an error)
 * in the URL fragment. The page must store the session and move to /my, or
 * surface the error with a retry hint — without touching the magic-link path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createApp } from '../../../backend/src/app';
import { trpc, makeQueryClient } from '../lib/trpc';
import { clearSessionToken, getSessionToken } from '../lib/auth';
import { AuthCallbackPage } from './AuthCallback';

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
            <Route path="/auth" element={<AuthCallbackPage />} />
            <Route path="/my" element={<p>my page stub</p>} />
          </Routes>
        </QueryClientProvider>
      </trpc.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => clearSessionToken());

describe('AuthCallbackPage — OAuth fragment', () => {
  it('stores the session from #session= and moves to /my', async () => {
    renderAt('/auth#session=oauth-session-token');
    await screen.findByText('my page stub');
    expect(getSessionToken()).toBe('oauth-session-token');
  });

  it('shows the error from #error= with a retry hint', async () => {
    renderAt('/auth#error=Google%20sign-in%20was%20cancelled.');
    await screen.findByText('Google sign-in was cancelled.');
    expect(screen.getByText(/try again from the \/my page/i)).toBeInTheDocument();
    await waitFor(() => expect(getSessionToken()).toBeNull());
  });

  it('still asks for a token when the URL carries neither', () => {
    renderAt('/auth');
    expect(screen.getByText(/missing login token/i)).toBeInTheDocument();
  });
});

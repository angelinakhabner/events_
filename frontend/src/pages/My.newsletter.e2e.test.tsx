/**
 * End-to-end-ish: mounts MyPage logged in against a real Hono backend,
 * in-process, and drives the newsletter flow (GOI-8) — configuring cadence,
 * an after-hour window and venues, saving, and seeing the settings persist.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { MemoryRouter } from 'react-router-dom';
import { createApp } from '../../../backend/src/app';
import { defaultAuthStore, requestMagicLink, verifyMagicLink } from '../../../backend/src/services/auth';
import { defaultNewsletterStore } from '../../../backend/src/services/newsletter-store';
import { trpc, makeQueryClient } from '../lib/trpc';
import { setSessionToken, getSessionToken } from '../lib/auth';
import { MyPage } from './My';

const DEVICE = 'e2e-newsletter-device';
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

beforeAll(async () => {
  const { token } = await requestMagicLink(defaultAuthStore, 'newsletter-e2e@example.com');
  const verified = await verifyMagicLink(defaultAuthStore, token);
  if (!verified) throw new Error('login failed');
  setSessionToken(verified.sessionToken);
  userId = verified.user.id;
});

describe('MyPage — newsletter end-to-end', () => {
  it('prefills the login email, saves settings, and persists them', async () => {
    const user = userEvent.setup();
    renderPage();

    // Wait for the form (the section shows a skeleton while settings load,
    // and the whole section subtree is replaced once they arrive).
    const email = (await screen.findByLabelText(/email address/i)) as HTMLInputElement;
    const section = email.closest('section')!;

    // Email defaults to the login address.
    expect(email.value).toBe('newsletter-e2e@example.com');

    // Daily, after 18:00.
    await user.selectOptions(within(section).getByLabelText(/how often/i), 'daily');
    await user.selectOptions(within(section).getByLabelText(/only events after/i), '18');
    await user.click(within(section).getByRole('button', { name: /save newsletter/i }));
    await within(section).findByText('Saved.');

    // Settings landed in the store.
    const saved = await defaultNewsletterStore.get(userId);
    expect(saved).toMatchObject({
      email: 'newsletter-e2e@example.com',
      frequency: 'daily',
      afterHour: 18,
      enabled: true,
    });
  });
});

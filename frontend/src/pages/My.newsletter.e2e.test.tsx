/**
 * End-to-end-ish: mounts MyPage logged in against a real Hono backend,
 * in-process, and drives the newsletter flow (GOI-8, GOI-28) — opening the
 * Newsletter section from the left-hand menu, configuring cadence, send time,
 * an after-hour window and the event-day scope, saving, and seeing the
 * settings persist.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

// Fresh identity per run — see the note in My.films.e2e.test.tsx: the CI
// Postgres outlives the process, so a fixed account carries state between runs.
const RUN = Math.random().toString(36).slice(2, 10);
const DEVICE = `e2e-newsletter-device-${RUN}`;
const USER_EMAIL = `newsletter-e2e-${RUN}@example.com`;
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
  const { token } = await requestMagicLink(defaultAuthStore, USER_EMAIL);
  const verified = await verifyMagicLink(defaultAuthStore, token);
  if (!verified) throw new Error('login failed');
  setSessionToken(verified.sessionToken);
  userId = verified.user.id;
});

describe('MyPage — newsletter end-to-end', () => {
  it('prefills the login email, saves settings, and persists them', async () => {
    const user = userEvent.setup();
    renderPage();

    // The page opens on Events; the newsletter lives behind its menu entry.
    await user.click(await screen.findByRole('button', { name: 'Newsletter' }));

    // Wait for the form (the section shows a skeleton while settings load,
    // and the whole section subtree is replaced once they arrive).
    const email = (await screen.findByLabelText(/email address/i)) as HTMLInputElement;
    const section = email.closest('section')!;

    // Email defaults to the login address. The prefill is async by design —
    // auth.me resolves in parallel with the settings query and the form
    // adopts the address once it lands — so wait rather than assert the
    // instant the form appears (the race made CI flaky).
    await waitFor(() => expect(email.value).toBe(USER_EMAIL));

    // Every hour and every minute is offered, not a hand-picked handful.
    const sendHour = within(section).getByLabelText(/^hour$/i);
    const sendMinute = within(section).getByLabelText(/^minute$/i);
    expect(within(sendHour).getAllByRole('option')).toHaveLength(24);
    expect(within(sendMinute).getAllByRole('option')).toHaveLength(60);
    expect(within(sendHour).getByRole('option', { name: '23' })).toBeInTheDocument();

    // Daily at 03:45, after 22:00 — none of the three reachable without the
    // full ranges.
    await user.selectOptions(within(section).getByLabelText(/how often/i), 'daily');
    await user.selectOptions(sendHour, '3');
    await user.selectOptions(sendMinute, '45');
    await user.selectOptions(within(section).getByLabelText(/only events after/i), '22');
    await user.click(within(section).getByRole('button', { name: /schedule newsletter/i }));
    await within(section).findByText('Saved.');

    // Settings landed in the store.
    const saved = await defaultNewsletterStore.get(userId);
    expect(saved).toMatchObject({
      email: USER_EMAIL,
      frequency: 'daily',
      sendHour: 3,
      sendMinute: 45,
      afterHour: 22,
      categoryRules: [],
      enabled: true,
    });
  });

  it('weekly briefs let you pick the weekday, and Generate renders a preview', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
    const email = (await screen.findByLabelText(/email address/i)) as HTMLInputElement;
    const section = email.closest('section')!;
    await waitFor(() => expect(email.value).toBe(USER_EMAIL));

    // The weekday picker only exists for weekly briefs.
    await user.selectOptions(within(section).getByLabelText(/how often/i), 'daily');
    expect(within(section).queryByLabelText(/day of the week/i)).not.toBeInTheDocument();

    await user.selectOptions(within(section).getByLabelText(/how often/i), 'weekly');
    await user.selectOptions(await within(section).findByLabelText(/day of the week/i), '4');
    await user.click(within(section).getByRole('button', { name: /schedule newsletter/i }));
    await within(section).findByText('Saved.');

    expect(await defaultNewsletterStore.get(userId)).toMatchObject({
      frequency: 'weekly',
      sendWeekday: 4,
    });

    // "Generate now" renders the brief the settings would produce, as the
    // recipient will see it. Without a database there are no events, so it
    // says so rather than 404ing.
    await user.click(within(section).getByRole('button', { name: /generate now/i }));
    const preview = (await screen.findByTestId('newsletter-preview')) as HTMLIFrameElement;
    // An email document, sandboxed — not markup spliced into the page.
    expect(preview.tagName).toBe('IFRAME');
    expect(preview.getAttribute('sandbox')).toBe('');
    expect(preview.srcdoc).toContain('AFISZ · WEEKLY');
    expect(preview.srcdoc).toContain('This week in<br>Warsaw');
    expect(preview.srcdoc).toContain('Nothing on in this window.');
  });

  // Per-category rules: each category gets its own cadence and depth.
  it('gives a category its own cadence and description width', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
    let section = (await screen.findByLabelText(/email address/i)).closest('section')!;

    // Categories come from your venues and their tags — cinema is there
    // because the seeded venues are cinemas.
    const picker = await within(section).findByLabelText(/add a category/i);
    await user.selectOptions(picker, 'cinema');

    await user.selectOptions(await within(section).findByLabelText(/how often for cinema/i), 'daily');
    await user.selectOptions(within(section).getByLabelText(/description for cinema/i), 'short');
    // Save before leaving: switching tabs unmounts the form, so anything not
    // yet saved is gone — the same as for any other section.
    await user.click(within(section).getByRole('button', { name: /schedule newsletter/i }));
    await within(section).findByText('Saved.');

    // A tag added over in "My venues" shows up here as a category too.
    await user.click(screen.getByRole('button', { name: 'My venues' }));
    const venuesSection = (await screen.findByRole('heading', { name: 'My venues' })).closest('section')!;
    const row = (await within(venuesSection).findByText('Kinoteka')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: /add tag to kinoteka/i }));
    await user.type(within(row).getByLabelText(/new tag for kinoteka/i), 'museums');
    await user.click(within(row).getByRole('button', { name: /^add$/i }));
    await within(venuesSection).findByText('museums');

    await user.click(screen.getByRole('button', { name: 'Newsletter' }));
    section = (await screen.findByLabelText(/email address/i)).closest('section')!;
    // The saved cinema rule comes back with the form.
    await within(section).findByLabelText(/how often for cinema/i);
    await user.selectOptions(await within(section).findByLabelText(/add a category/i), 'museums');

    // Museums monthly, with the wide write-up — the example from the brief.
    await user.selectOptions(await within(section).findByLabelText(/how often for museums/i), 'monthly');
    await user.selectOptions(within(section).getByLabelText(/description for museums/i), 'full');

    await user.click(within(section).getByRole('button', { name: /schedule newsletter/i }));
    await within(section).findByText('Saved.');

    expect((await defaultNewsletterStore.get(userId))!.categoryRules).toEqual([
      { category: 'cinema', frequency: 'daily', detail: 'short' },
      { category: 'museums', frequency: 'monthly', detail: 'full' },
    ]);
  });

  it('drops a category rule again', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
    const section = (await screen.findByLabelText(/email address/i)).closest('section')!;

    // The saved rules from the previous test are loaded back into the form.
    await within(section).findByLabelText(/how often for cinema/i);
    await user.click(within(section).getByRole('button', { name: /remove cinema/i }));
    await user.click(within(section).getByRole('button', { name: /schedule newsletter/i }));
    await within(section).findByText('Saved.');

    expect((await defaultNewsletterStore.get(userId))!.categoryRules.map((r) => r.category))
      .toEqual(['museums']);
  });
});

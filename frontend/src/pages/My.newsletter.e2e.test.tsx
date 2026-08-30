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

    // Daily at 03:45 — neither reachable without the full ranges.
    await user.click(within(section).getByRole('radio', { name: /every day/i }));
    await user.selectOptions(sendHour, '3');
    await user.selectOptions(sendMinute, '45');

    // GOI-100: the global "only events after" is gone. It applied to every
    // section at once, which silently emptied museums — exhibitions are
    // daytime. Time of day is per category now, in the table below.
    expect(within(section).queryByLabelText(/only events after/i)).not.toBeInTheDocument();

    // GOI-30: the line under the heading describes the brief you have set up,
    // so it has to follow the controls rather than state a fixed example.
    expect(within(section).getByText(/emailed to/i)).toHaveTextContent(
      'every day at 03:45.',
    );

    await user.click(within(section).getByRole('button', { name: /schedule newsletter/i }));
    await within(section).findByText('Saved.');

    // Settings landed in the store.
    const saved = await defaultNewsletterStore.get(userId);
    expect(saved).toMatchObject({
      email: USER_EMAIL,
      sendCadence: 'daily',
      sendHour: 3,
      sendMinute: 45,
      categoryRules: [],
      enabled: true,
    });
  });

  /**
   * GOI-60: the cadence is a segmented control rather than a dropdown, so the
   * choice is legible without opening anything. These pin the behaviour the
   * visual change has to keep — one selected option at a time, and the
   * selection actually reaching the payload.
   */
  it('shows the cadence as a segmented control with exactly one option selected', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
    const email = (await screen.findByLabelText(/email address/i)) as HTMLInputElement;
    const section = email.closest('section')!;
    await waitFor(() => expect(email.value).toBe(USER_EMAIL));

    const group = within(section).getByRole('radiogroup', { name: /how often/i });
    const daily = within(group).getByRole('radio', { name: /every day/i });
    const weekly = within(group).getByRole('radio', { name: /weekly/i });

    // Every option is on screen — that is the point of the control.
    expect(within(group).getAllByRole('radio')).toHaveLength(3);

    await user.click(daily);
    expect(daily).toHaveAttribute('aria-checked', 'true');
    expect(weekly).toHaveAttribute('aria-checked', 'false');

    await user.click(weekly);
    expect(weekly).toHaveAttribute('aria-checked', 'true');
    expect(daily).toHaveAttribute('aria-checked', 'false');
  });

  /**
   * GOI-100. Monthly used to be withheld here on the grounds that it meant
   * eleven silent months — which it did, while a category's own cadence was
   * the only thing deciding what an issue contained. Now that the envelope and
   * the contents are separate, a monthly issue is an ordinary choice, and it
   * brings a day-of-month picker with it because a monthly newsletter with no
   * send day has no send day at all.
   */
  it('offers monthly, with the day of the month it needs', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
    const email = await screen.findByLabelText(/email address/i);
    const section = email.closest('section')!;

    const group = within(section).getByRole('radiogroup', { name: /how often/i });
    const monthly = within(group).getByRole('radio', { name: /monthly/i });
    expect(within(section).queryByLabelText(/^on$/i)).not.toBeInTheDocument();

    await user.click(monthly);
    const dayOfMonth = await within(section).findByLabelText(/^on$/i);
    // 1-28, so February has an issue too.
    expect(within(dayOfMonth).getAllByRole('option')).toHaveLength(28);
    expect(within(dayOfMonth).getByRole('option', { name: '1st' })).toBeInTheDocument();
    expect(within(dayOfMonth).queryByRole('option', { name: '31st' })).not.toBeInTheDocument();
  });

  it('weekly briefs let you pick the weekday, and Generate renders a preview', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
    const email = (await screen.findByLabelText(/email address/i)) as HTMLInputElement;
    const section = email.closest('section')!;
    await waitFor(() => expect(email.value).toBe(USER_EMAIL));

    // The weekday picker only exists for weekly briefs. Cadence is a segmented
    // control (GOI-60) — a radiogroup, so each option is its own radio.
    await user.click(within(section).getByRole('radio', { name: /every day/i }));
    expect(within(section).queryByLabelText(/^on$/i)).not.toBeInTheDocument();

    await user.click(within(section).getByRole('radio', { name: /weekly/i }));
    await user.selectOptions(await within(section).findByLabelText(/^on$/i), '4');
    await user.click(within(section).getByRole('button', { name: /schedule newsletter/i }));
    await within(section).findByText('Saved.');

    expect(await defaultNewsletterStore.get(userId)).toMatchObject({
      sendCadence: 'weekly',
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

  // GOI-45: generating also drops the brief on disk, ready to send by hand.
  // GOI-91 made that a PDF — the same document the drive copy files, so what
  // gets forwarded by hand and what lands in the folder cannot drift apart.
  it('saves the generated brief as a dated PDF', async () => {
    const user = userEvent.setup();
    // jsdom has no blob URLs; stand one up so the helper gets as far as the
    // anchor, and record what it would have saved.
    const saved: { name: string; type: string }[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const origClick = HTMLAnchorElement.prototype.click;
    let lastType = '';
    URL.createObjectURL = ((blob: Blob) => { lastType = blob.type; return 'blob:stub'; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.download) saved.push({ name: this.download, type: lastType });
    };

    try {
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
      const section = (await screen.findByLabelText(/email address/i)).closest('section')!;
      await user.click(within(section).getByRole('button', { name: /generate now/i }));
      await screen.findByTestId('newsletter-preview');

      expect(saved).toHaveLength(1);
      expect(saved[0]!.name).toMatch(/^afisz-\d{4}-\d{2}-\d{2}-(daily|weekly|monthly)\.pdf$/);
      expect(saved[0]!.type).toBe('application/pdf');

      // And it can be saved again without regenerating — as either format,
      // since the .html one is what you paste into a mail client.
      await user.click(screen.getByRole('button', { name: /download pdf/i }));
      expect(saved).toHaveLength(2);
      expect(saved[1]!.type).toBe('application/pdf');

      await user.click(screen.getByRole('button', { name: /download \.html/i }));
      expect(saved).toHaveLength(3);
      expect(saved[2]!.type).toBe('text/html;charset=utf-8');
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      HTMLAnchorElement.prototype.click = origClick;
    }
  });

  // The download is a side benefit; the preview is the point. A browser that
  // refuses the blob URL must still render the brief.
  it('still shows the preview when the file can\'t be saved', async () => {
    const user = userEvent.setup();
    const orig = URL.createObjectURL;
    // @ts-expect-error — modelling an environment without blob URLs.
    URL.createObjectURL = undefined;
    try {
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
      const section = (await screen.findByLabelText(/email address/i)).closest('section')!;
      await user.click(within(section).getByRole('button', { name: /generate now/i }));
      expect(await screen.findByTestId('newsletter-preview')).toBeInTheDocument();
    } finally {
      URL.createObjectURL = orig;
    }
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

    await user.selectOptions(
      await within(section).findByLabelText(/how often for cinema/i), 'every_issue',
    );
    await user.selectOptions(within(section).getByLabelText(/description for cinema/i), 'short');
    // GOI-100: time of day is per category now. Cinema after 18:00 is the
    // setting that used to be global — and that used to empty museums.
    await user.selectOptions(within(section).getByLabelText(/time of day for cinema/i), 'after_18');
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

    // Museums monthly, with the full write-up — the example from the brief.
    await user.selectOptions(await within(section).findByLabelText(/how often for museums/i), 'monthly');
    await user.selectOptions(within(section).getByLabelText(/description for museums/i), 'full');
    // …and left at "any time", which is the point of the per-row filter: the
    // one global setting could not say "evenings for cinema, any time for
    // exhibitions", so it said "evenings" and museums went silent.
    expect(within(section).getByLabelText(/time of day for museums/i)).toHaveValue('any');

    await user.click(within(section).getByRole('button', { name: /schedule newsletter/i }));
    await within(section).findByText('Saved.');

    expect((await defaultNewsletterStore.get(userId))!.categoryRules).toEqual([
      {
        category: 'cinema', cadence: 'every_issue', cadenceWeekday: null,
        detail: 'short', timeFilter: 'after_18', lookaheadDays: null, sortOrder: 0,
      },
      {
        category: 'museums', cadence: 'monthly', cadenceWeekday: null,
        detail: 'full', timeFilter: 'any', lookaheadDays: null, sortOrder: 1,
      },
    ]);
  });

  /**
   * The delivery choice: email, a PDF filed on a connected drive, or both.
   *
   * Email is the default because it is what every config already was — a
   * migration that switched anyone's delivery would be a feature that silently
   * stopped their newsletter arriving.
   */
  describe('where the brief goes', () => {
    it('offers the three destinations, defaulting to email', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
      const section = (await screen.findByLabelText(/email address/i)).closest('section')!;

      const group = within(section).getByRole('radiogroup', { name: /how to send it/i });
      expect(within(group).getAllByRole('radio')).toHaveLength(3);
      expect(within(group).getByRole('radio', { name: /^email$/i })).toHaveAttribute('aria-checked', 'true');
    });

    it('saves the choice, and the summary line stops claiming an email', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
      const section = (await screen.findByLabelText(/email address/i)).closest('section')!;
      const group = within(section).getByRole('radiogroup', { name: /how to send it/i });

      await user.click(within(group).getByRole('radio', { name: /^drive$/i }));
      // GOI-30's rule: the line above the controls must not state a fiction.
      // "Emailed to ada@example.com" is one for a reader who chose the drive.
      expect(within(section).getByText(/filed to your drive/i)).toBeInTheDocument();

      await user.click(within(section).getByRole('button', { name: /schedule newsletter/i }));
      await within(section).findByText('Saved.');
      expect(await defaultNewsletterStore.get(userId)).toMatchObject({ delivery: 'drive' });
    });

    /**
     * The setting is accepted with no drive connected — a reader may
     * reasonably choose it and connect the drive next, and refusing would make
     * the two steps order-dependent. What it must not be is silent: a
     * drive-only newsletter with nothing connected produces no brief at all.
     *
     * Asserted as "says something" rather than "shows this exact alert",
     * because the precise wording depends on whether the drive-status query
     * answered — and the guarantee that matters is that it is never quiet.
     * This environment is the awkward one: `defaultDriveStore` is the database
     * store unconditionally, so with no database the query fails and retries,
     * and a note that waited for it would never appear at all.
     */
    it('never goes quiet about needing a drive', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
      const section = (await screen.findByLabelText(/email address/i)).closest('section')!;
      const group = within(section).getByRole('radiogroup', { name: /how to send it/i });

      // Start from a known state: an earlier test in this file saves a
      // delivery choice, and the form loads whatever is stored.
      await user.click(within(group).getByRole('radio', { name: /^email$/i }));
      expect(
        within(section).queryByText(/nowhere to file|briefs are filed to the drive/i),
      ).not.toBeInTheDocument();

      for (const choice of [/^drive$/i, /^both$/i]) {
        await user.click(within(group).getByRole('radio', { name: choice }));
        expect(
          within(section).getByText(/nowhere to file|briefs are filed to the drive|aren.t available/i),
        ).toBeInTheDocument();
      }

      // …and goes quiet again once no drive is involved.
      await user.click(within(group).getByRole('radio', { name: /^email$/i }));
      expect(
        within(section).queryByText(/nowhere to file|briefs are filed to the drive/i),
      ).not.toBeInTheDocument();
    });

    it('says the address is not a destination when only the drive is used', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
      const section = (await screen.findByLabelText(/email address/i)).closest('section')!;
      const group = within(section).getByRole('radiogroup', { name: /how to send it/i });

      await user.click(within(group).getByRole('radio', { name: /^drive$/i }));
      expect(within(section).getByText(/nothing is emailed with this setting/i)).toBeInTheDocument();

      // …and stops saying it once an email is involved again.
      await user.click(within(group).getByRole('radio', { name: /^both$/i }));
      expect(within(section).queryByText(/nothing is emailed with this setting/i)).not.toBeInTheDocument();
    });
  });

  /**
   * GOI-102 §2: the options a schedule makes impossible are **disabled, not
   * removed**. A vanished dropdown option reads as a bug or a moved control;
   * a greyed one teaches the rule in the place the rule applies.
   */
  it('clamps the category cadences to what the send schedule can carry', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
    const section = (await screen.findByLabelText(/email address/i)).closest('section')!;
    const cadence = await within(section).findByLabelText(/how often for museums/i);

    // Daily: every option is reachable.
    await user.click(within(section).getByRole('radio', { name: /every day/i }));
    for (const name of [/every issue/i, /once a week/i, /once a month/i]) {
      expect(within(cadence).getByRole('option', { name })).not.toBeDisabled();
    }

    // Weekly: "once a week" *is* every issue, so it is offered but unusable.
    await user.click(within(section).getByRole('radio', { name: /weekly/i }));
    expect(within(cadence).getByRole('option', { name: /once a week/i })).toBeDisabled();
    expect(within(cadence).getByRole('option', { name: /once a month/i })).not.toBeDisabled();

    // Monthly: nothing is finer than the envelope, so nothing else is left.
    await user.click(within(section).getByRole('radio', { name: /monthly/i }));
    expect(within(cadence).getByRole('option', { name: /once a week/i })).toBeDisabled();
    expect(within(cadence).getByRole('option', { name: /once a month/i })).toBeDisabled();
    expect(within(cadence).getByRole('option', { name: /every issue/i })).not.toBeDisabled();
  });

  /**
   * GOI-102: changing the envelope can invalidate the contents. The old
   * values are reconciled rather than left to fail on save — but *silently*
   * rewriting a reader's choice is how a form loses their trust, so what
   * changed is named.
   */
  it('says what changing the send cadence did to a category', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
    const section = (await screen.findByLabelText(/email address/i)).closest('section')!;

    await user.click(within(section).getByRole('radio', { name: /every day/i }));
    const cadence = await within(section).findByLabelText(/how often for museums/i);
    await user.selectOptions(cadence, 'weekly');

    // Weekly issues cannot carry a weekly category — that is every issue.
    await user.click(within(section).getByRole('radio', { name: /weekly/i }));
    expect(cadence).toHaveValue('every_issue');
    expect(await within(section).findByRole('status')).toHaveTextContent(/museums moved to/i);
  });

  /** GOI-102 §2: the derived window is shown, so the override is answerable
   *  without arithmetic. */
  it('shows the window a category covers before offering to override it', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
    const section = (await screen.findByLabelText(/email address/i)).closest('section')!;

    await user.click(within(section).getByRole('radio', { name: /every day/i }));
    const cadence = await within(section).findByLabelText(/how often for museums/i);

    // Every issue of a daily newsletter covers a day…
    await user.selectOptions(cadence, 'every_issue');
    expect(within(section).getByRole('button', { name: /set how far ahead museums looks/i }))
      .toHaveTextContent('Look ahead: 1 days');

    // …and a monthly section of one covers a month.
    await user.selectOptions(cadence, 'monthly');
    expect(within(section).getByRole('button', { name: /set how far ahead museums looks/i }))
      .toHaveTextContent('Look ahead: 30 days');
  });

  /**
   * GOI-102 §3 / GOI-101. Saved events are not a category: they are a queue of
   * things the reader already chose, and the settings for them sit in their own
   * block rather than as a row in the table.
   */
  it('carries the saved-events block, with the urgent toggle nested under changes', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
    const section = (await screen.findByLabelText(/email address/i)).closest('section')!;

    const include = within(section).getByLabelText(/include events i saved/i);
    const changes = within(section).getByLabelText(/cancelled or rescheduled/i);
    const urgent = within(section).getByLabelText(/send immediately for urgent changes/i);
    expect(include).toBeChecked();
    expect(urgent).toBeEnabled();

    // An urgent send is a kind of change report, so offering it while change
    // reports are off would be offering something that can never happen.
    await user.click(changes);
    expect(urgent).toBeDisabled();

    await user.click(changes);
    await user.click(include);
    expect(changes).toBeDisabled();
    expect(urgent).toBeDisabled();
  });

  /**
   * GOI-100 rule 4 / GOI-102 §6: a newsletter with no categories and no saved
   * events can never produce content. Blocked at the table it concerns rather
   * than as a toast, and blocked *before* the request, since a server error
   * for something the form can see is a round trip spent saying nothing.
   */
  it('blocks a newsletter that would always be empty, against the table', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Newsletter' }));
    const section = (await screen.findByLabelText(/email address/i)).closest('section')!;

    // Drop every rule, then switch saved events off. Whatever the previous
    // tests left saved, the point is the state with nothing in it.
    await within(section).findByLabelText(/how often for museums/i);
    // Re-queried each time: removing a row rebuilds the list under us.
    for (;;) {
      const [remove] = within(section).queryAllByRole('button', { name: /^remove /i });
      if (!remove) break;
      await user.click(remove);
    }
    await user.click(within(section).getByLabelText(/include events i saved/i));

    // Named rather than "the alert": the delivery choice raises one of its own
    // when a drive is asked for and none is connected, and a previous test in
    // this file leaves that choice saved.
    expect(
      await within(section).findByText(/this newsletter would always be empty/i),
    ).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /schedule newsletter/i })).toBeDisabled();
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

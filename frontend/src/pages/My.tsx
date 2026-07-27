import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { clearSessionToken, isLoggedIn } from '../lib/auth';
import { MyEventsSection } from '../components/MyEventsSection';
import { MyVenuesSection } from '../components/MyVenuesSection';
import { WantToGoSection } from '../components/WantToGoSection';
import { NewsletterSection } from '../components/NewsletterSection';

/** The left-hand menu (GOI-24). `key` doubles as the ?tab= value. */
const SECTIONS = [
  { key: 'events', label: 'Events' },
  { key: 'venues', label: 'My venues' },
  { key: 'want-to-go', label: 'Want to go' },
  { key: 'newsletter', label: 'Newsletter' },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

function isSectionKey(v: string | null): v is SectionKey {
  return SECTIONS.some((s) => s.key === v);
}

/**
 * /my — the logged-in home. A left-hand menu switches between what's on at
 * your venues, the venues themselves, your "want to go" list and the
 * newsletter. Logged-out visitors get the magic-link login form.
 *
 * The active section lives in ?tab= so a section is linkable and survives a
 * reload; anything unrecognised falls back to Events.
 */
export function MyPage() {
  const loggedIn = isLoggedIn();
  const me = trpc.auth.me.useQuery(undefined, { enabled: loggedIn });
  const [params, setParams] = useSearchParams();

  const raw = params.get('tab');
  const section: SectionKey = isSectionKey(raw) ? raw : 'events';

  if (!loggedIn || (me.isFetched && !me.data)) {
    return <LoginSection />;
  }
  return (
    <div>
      <header className="mb-10 flex items-baseline justify-between">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">My page</h1>
          {me.data ? <p className="mt-2 text-muted">{me.data.email}</p> : null}
        </div>
        <LogoutButton />
      </header>

      <div className="flex flex-col gap-10 md:flex-row md:gap-12">
        <nav aria-label="My page sections" className="shrink-0 md:w-44">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 list-none m-0 p-0 md:flex-col md:gap-2">
            {SECTIONS.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  aria-current={section === s.key ? 'page' : undefined}
                  onClick={() => setParams({ tab: s.key })}
                  className={`w-full text-left text-sm bg-transparent border-0 cursor-pointer p-0 md:py-1 ${
                    section === s.key ? 'text-ink' : 'text-muted hover:text-ink'
                  }`}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          {section === 'events' ? <MyEventsSection /> : null}
          {section === 'venues' ? <MyVenuesSection /> : null}
          {section === 'want-to-go' ? <WantToGoSection /> : null}
          {section === 'newsletter' ? <NewsletterSection defaultEmail={me.data?.email ?? ''} /> : null}
        </div>
      </div>
    </div>
  );
}

// ─── Login ───────────────────────────────────────────────────────────────────

function LoginSection() {
  const [email, setEmail] = useState('');
  const request = trpc.auth.requestLink.useMutation();
  const methods = trpc.auth.methods.useQuery();

  if (request.isSuccess) {
    return (
      <section className="mx-auto mt-16 max-w-sm text-center">
        <h1 className="font-serif text-3xl tracking-tight">Check your email</h1>
        <p className="mt-3 text-sm text-muted">
          {request.data.emailSent ? (
            <>
              We sent a sign-in link to <span className="text-ink">{email}</span>.
              <br />
              It&rsquo;s valid for 15 minutes and works once.
            </>
          ) : (
            'Email sending is not configured on this server — ask the operator for the login link from the server log.'
          )}
        </p>
        <button
          type="button"
          onClick={() => request.reset()}
          className="mt-8 text-sm text-muted hover:text-ink bg-transparent border-0 cursor-pointer underline underline-offset-4"
        >
          Use a different address
        </button>
      </section>
    );
  }

  return (
    <section className="mx-auto mt-16 max-w-sm">
      <div className="text-center">
        <h1 className="font-serif text-3xl tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted">Enter your email to receive a sign-in link</p>
      </div>

      <form
        className="mt-8 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) request.mutate({ email: email.trim() });
        }}
      >
        <label className="sr-only" htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded border border-rule bg-paper px-4 py-2.5 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={request.isPending}
          className="w-full rounded bg-accent/90 text-paper px-4 py-2.5 text-sm cursor-pointer border-0 hover:bg-accent disabled:opacity-50"
        >
          {request.isPending ? 'Sending…' : 'Continue with email'}
        </button>
      </form>
      {request.error ? (
        <p className="mt-3 text-center text-sm text-muted">{request.error.message}</p>
      ) : null}

      {methods.data?.google ? (
        <>
          <div className="mt-6 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-rule" aria-hidden />
            or
            <span className="h-px flex-1 bg-rule" aria-hidden />
          </div>
          <a
            href={`${import.meta.env.VITE_API_URL ?? ''}/auth/google`}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded border border-rule bg-paper px-4 py-2.5 text-sm text-ink no-underline hover:border-ink"
          >
            <GoogleMark />
            Sign in with Google
          </a>
        </>
      ) : null}

      <p className="mt-10 text-center text-xs text-muted">
        No password to remember — your venues, folders, films and &ldquo;want to go&rdquo; list
        live behind this sign-in.
      </p>
    </section>
  );
}

/** The four-colour Google "G", inline so the page stays asset-free. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function LogoutButton() {
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({
    onSettled: async () => {
      clearSessionToken();
      await utils.invalidate();
      window.location.assign('/');
    },
  });
  return (
    <button
      type="button"
      onClick={() => logout.mutate()}
      className="text-sm text-muted hover:text-ink bg-transparent border-0 cursor-pointer"
    >
      Log out
    </button>
  );
}

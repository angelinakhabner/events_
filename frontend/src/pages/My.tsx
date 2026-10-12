import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { isLoggedIn } from '../lib/auth';
import { MyEventsSection } from '../components/MyEventsSection';
import { MyVenuesSection } from '../components/MyVenuesSection';
import { WantToGoSection } from '../components/WantToGoSection';
import { NewsletterSection } from '../components/NewsletterSection';
import { FestivalBanner } from '../components/FestivalBanner';

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
    <>
      {/* GOI-99: the same banner Home carries, narrowed to the venues this
          reader actually follows — above the section menu, so it is the first
          thing on /my whichever tab is open. */}
      <MyFestivalBanner />

      <div className="md:flex md:gap-14 md:page-x md:pt-12">
        {/* Two shapes for one menu. From `md` it is the poster sidebar: the page
            title, the address it belongs to, and four rules with a red marker
            square on the active row. Below that it becomes a horizontally
            scrolling tab strip, because a 220px column would leave the listing
            nothing to live in. */}
        <div className="md:w-[220px] md:shrink-0">
          <div className="page-x md:px-0 pt-6 pb-2.5 md:pt-0">
            <h1 className="font-display text-[30px] md:text-[42px] tracking-[0.5px] m-0">My page</h1>
            {me.data ? (
              <p className="mt-1 text-xs md:text-sm text-muted">{me.data.email}</p>
            ) : null}
          </div>

          <nav
            aria-label="My page sections"
            className="flex scroll-x border-y-2 border-ink md:mt-9 md:flex-col md:border-b-0 md:border-t-0"
          >
            {SECTIONS.map((s) => {
              const active = section === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setParams({ tab: s.key })}
                  className="flex shrink-0 items-center gap-2.5 whitespace-nowrap border-r-2 border-ink px-4 py-3.5 cursor-pointer bg-transparent md:w-full md:border-r-0 md:border-t-2 md:px-0 md:py-3.5 md:last:border-b-2"
                >
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 md:h-2.5 md:w-2.5 ${active ? 'bg-accent' : 'bg-transparent'}`}
                  />
                  <span
                    className={`text-[13px] md:text-base tracking-[0.3px] ${
                      active ? 'font-extrabold text-ink' : 'font-medium text-ink'
                    }`}
                  >
                    {s.label}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="min-w-0 flex-1 page-x md:px-0 pt-8 md:pt-0">
          {section === 'events' ? <MyEventsSection /> : null}
          {section === 'venues' ? <MyVenuesSection /> : null}
          {section === 'want-to-go' ? <WantToGoSection /> : null}
          {section === 'newsletter' ? <NewsletterSection defaultEmail={me.data?.email ?? ''} /> : null}
        </div>
      </div>
    </>
  );
}

/** The banner's /my half: `festivals.mine` rather than the public list, so it
 *  announces only what is on at venues this reader follows (GOI-33, GOI-99). */
function MyFestivalBanner() {
  const mine = trpc.festivals.mine.useQuery();
  return <FestivalBanner festivals={mine.data} label="Festivals at your venues" />;
}

// ─── Login ───────────────────────────────────────────────────────────────────

/**
 * The login card from the design pack, rendered in place rather than as a
 * modal: /my is a real route here, so there is no page behind the card to dim.
 * Same anatomy either way — heavy border, Anton heading, red rule, one filled
 * action and one outlined alternative.
 */
function LoginSection() {
  const [email, setEmail] = useState('');
  const request = trpc.auth.requestLink.useMutation();
  const methods = trpc.auth.methods.useQuery();

  if (request.isSuccess) {
    return (
      <LoginCard title="Check your email">
        <p className="text-sm text-body">
          {request.data.emailSent ? (
            <>
              We sent a sign-in link to <span className="font-bold text-ink">{email}</span>.
              {' '}It&rsquo;s valid for 15 minutes and works once.
            </>
          ) : (
            'Email sending is not configured on this server — ask the operator for the login link from the server log.'
          )}
        </p>
        <button type="button" onClick={() => request.reset()} className="mt-7 act act-on">
          Use a different address
        </button>
      </LoginCard>
    );
  }

  return (
    <LoginCard title="Log in">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) request.mutate({ email: email.trim() });
        }}
      >
        <label className="label-caps mb-1.5" htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="field mb-5"
        />
        <button type="submit" disabled={request.isPending} className="btn-accent w-full text-left text-sm">
          {request.isPending ? 'Sending…' : 'Continue with email →'}
        </button>
      </form>
      {request.error ? (
        <p className="mt-3 text-sm text-accent">{request.error.message}</p>
      ) : null}

      {methods.data?.google ? (
        <>
          <p className="my-3.5 text-center text-xs font-bold uppercase tracking-[1px] text-muted">or</p>
          <a
            href={`${import.meta.env.VITE_API_URL ?? ''}/auth/google`}
            className="btn-outline flex w-full items-center gap-3 text-sm"
          >
            <GoogleMark />
            Continue with Google
          </a>
        </>
      ) : null}

      <p className="mt-8 text-xs text-muted">
        No password to remember — your venues, folders, films and &ldquo;want to go&rdquo; list
        live behind this sign-in.
      </p>
    </LoginCard>
  );
}

function LoginCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="page-x py-12 md:py-20">
      <div className="mx-auto w-full max-w-[440px] border-4 border-ink bg-panel p-7 md:p-12">
        <h1 className="font-display text-[28px] md:text-[38px] m-0 mb-2 uppercase">{title}</h1>
        <div aria-hidden className="mb-6 md:mb-7 h-[5px] w-16 bg-accent" />
        {children}
      </div>
    </div>
  );
}

/** The four-colour Google "G", inline so the page stays asset-free. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden focusable="false" className="shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

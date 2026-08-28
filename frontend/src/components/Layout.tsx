import { NavLink, Outlet } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { clearSessionToken, isLoggedIn } from '../lib/auth';

/**
 * The poster chrome: a wordmark with its red square, a two-item nav, and a
 * thick rule under the lot. Nothing is centred and nothing is boxed — the
 * header runs the full width and the rule below it is the only separation.
 *
 * Below `md` the nav moves to a fixed bottom tab bar, which is why `main`
 * carries bottom padding there: the bar sits over the end of the page.
 *
 * On the dev preview the wordmark carries a DEV chip, matching the DEV-marked
 * app icon that build ships — so a screenshot of the staging site is never
 * mistaken for production.
 */
export function Layout() {
  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center justify-between gap-4 page-x py-4 md:py-7 border-b-4 md:border-b-5 border-ink">
        <NavLink to="/" className="flex items-baseline gap-2">
          <span className="font-display text-[22px] md:text-[34px] tracking-[0.5px] md:tracking-[1px] text-ink">
            AFISZ
          </span>
          <span aria-hidden className="inline-block h-[7px] w-[7px] md:h-2.5 md:w-2.5 bg-accent" />
          <DevBadge />
        </NavLink>

        <nav className="hidden md:flex items-center gap-10">
          <HeaderLink to="/" end>Home</HeaderLink>
          <HeaderLink to="/my">/my</HeaderLink>
          <LogoutButton />
        </nav>

        {/* Mobile keeps only the log-out affordance up top; Home and /my live
            in the bottom tab bar. */}
        <div className="md:hidden">
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 pb-24 md:pb-20">
        <Outlet />
      </main>

      <nav
        aria-label="Sections"
        className="md:hidden fixed inset-x-0 bottom-0 z-20 flex bg-paper border-t-4 border-ink"
      >
        <TabLink to="/" end>Home</TabLink>
        <TabLink to="/my">/my</TabLink>
      </nav>
    </div>
  );
}

/** Renders nothing outside the dev-preview build. */
function DevBadge() {
  if (import.meta.env.VITE_APP_VARIANT !== 'dev') return null;
  return (
    <span className="ml-1 px-1.5 py-0.5 bg-accent text-paper font-display text-[11px] md:text-[15px] leading-none tracking-[1px] self-center">
      DEV
    </span>
  );
}

function HeaderLink({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `pb-1.5 text-[15px] font-bold uppercase tracking-[1.5px] text-ink hover:text-accent border-b-3 ${
          isActive ? 'border-accent' : 'border-transparent'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function TabLink({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex-1 text-center pt-3 pb-2.5 text-[13px] font-extrabold uppercase tracking-[1px] text-ink border-b-4 border-l-2 border-l-ink first:border-l-0 ${
          isActive ? 'border-b-accent' : 'border-b-transparent'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

/** Renders nothing for logged-out visitors — there is no session to end. */
function LogoutButton() {
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({
    onSettled: async () => {
      clearSessionToken();
      await utils.invalidate();
      window.location.assign('/');
    },
  });
  if (!isLoggedIn()) return null;
  return (
    <button type="button" onClick={() => logout.mutate()} className="act act-sm md:text-sm">
      Log out
    </button>
  );
}

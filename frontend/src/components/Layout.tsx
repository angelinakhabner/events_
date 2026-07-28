import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

/**
 * Poster masthead (GOI-34) — the app's counterpart to the newsletter's.
 *
 * A full-bleed ink band carrying the wordmark, over a cream content sheet.
 * The brief opens exactly this way, so a reader arriving from the email lands
 * on something recognisable rather than on a different-looking product.
 *
 * Nav labels are unchanged; this is a visual pass, not an IA one.
 */
export function Layout() {
  return (
    <div className="min-h-full">
      <header className="bg-ink">
        <div className="mx-auto max-w-readable px-5 py-7 flex items-end justify-between gap-6">
          <NavLink to="/" className="no-underline">
            <span className="block font-display text-[11px] font-semibold tracking-[0.14em] uppercase text-onInkMuted">
              Warsaw
            </span>
            <span className="block headline text-3xl text-onInk">Goin</span>
          </NavLink>
          <nav className="flex gap-6 pb-1">
            <MastheadLink to="/" end>
              Home
            </MastheadLink>
            <MastheadLink to="/my">/my</MastheadLink>
          </nav>
        </div>
      </header>

      {/* The sheet. `page` shows around it on wide viewports, which is what
          makes the column read as printed matter rather than as the window. */}
      <main className="mx-auto max-w-readable min-h-full bg-paper px-5 pt-10 pb-24">
        <Outlet />
      </main>
    </div>
  );
}

function MastheadLink({
  to,
  end,
  children,
}: {
  to: string;
  end?: boolean;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `no-underline font-display text-[11px] font-semibold tracking-[0.12em] uppercase transition-colors ${
          isActive ? 'text-onInk' : 'text-onInkMuted hover:text-onInk'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

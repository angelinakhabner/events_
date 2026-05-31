import { NavLink, Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="min-h-full">
      <header className="mx-auto max-w-readable px-5 pt-10 pb-8 flex items-baseline justify-between">
        <NavLink to="/" className="no-underline">
          <span className="font-serif text-2xl tracking-tight">Goin</span>
        </NavLink>
        <nav className="flex gap-6 text-sm">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `no-underline ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`
            }
          >
            Home
          </NavLink>
          <NavLink
            to="/my"
            className={({ isActive }) =>
              `no-underline ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`
            }
          >
            /my
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-readable px-5 pb-24">
        <Outlet />
      </main>
    </div>
  );
}

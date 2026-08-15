import { useEffect, useState, type ReactNode } from 'react';

/**
 * The client half of the access gate (GOI-83).
 *
 * The gate is enforced on the server — every route and every tRPC procedure
 * is denied without the cookie — so this component is not the security
 * boundary and must not be mistaken for one. What it is for: making sure a
 * visitor without an invite never sees the app shell and never fires a query.
 * A redirect after the app has mounted would already have leaked the layout
 * and spent a round of requests.
 *
 * It can't read the cookie itself (httpOnly, and set on the API's origin), so
 * it asks the API once. Until the answer arrives it renders nothing at all —
 * a "loading" flash of app chrome would defeat the point.
 *
 * Removing the gate later is deleting this file and its two lines in main.tsx.
 */

type GateState = 'checking' | 'open' | 'closed';

export function InviteGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('checking');

  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.VITE_API_URL ?? '';

    // `credentials: 'include'` is the whole point of the request — the SPA and
    // the API are different origins here, so the cookie only rides along when
    // it is asked for explicitly.
    fetch(`${base}/gate`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { open: false }))
      .then((body: { open?: boolean }) => {
        if (!cancelled) setState(body.open ? 'open' : 'closed');
      })
      .catch(() => {
        // API unreachable: fail closed. Showing the app to someone we can't
        // verify is the one outcome that matters here.
        if (!cancelled) setState('closed');
      });

    return () => { cancelled = true; };
  }, []);

  if (state === 'checking') return null;
  if (state === 'closed') return <NotAvailable />;
  return <>{children}</>;
}

/**
 * Carries no venue names, no event data, and no copy describing what this is.
 * There is deliberately nothing here worth indexing — and nothing that tells a
 * stranger what they're missing.
 */
function NotAvailable() {
  return (
    <div className="min-h-full flex items-center justify-center px-5">
      <p className="text-sm text-muted">Not available.</p>
    </div>
  );
}

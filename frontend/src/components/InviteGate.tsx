import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { hideLanding, rememberGate, showLanding } from '../lib/landing';

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
 * What a visitor without an invite sees is no longer this component's
 * business. The public landing page (`src/landing/render.ts`) is already in
 * the document when the browser gets it, so the closed case is not something
 * to render but something to leave alone; the open case draws the curtain
 * over it. That also means the page a stranger reads is complete before any
 * of this runs, which is the point of serving it statically.
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

  // Before paint, not after: the app has just been committed into `#root`,
  // which the landing page's stylesheet keeps collapsed while the landing is
  // up. Deferring this to a passive effect would paint one blank frame.
  useLayoutEffect(() => {
    if (state === 'checking') return;
    const open = state === 'open';
    if (open) hideLanding();
    else showLanding();
    rememberGate(open);
  }, [state]);

  return state === 'open' ? <>{children}</> : null;
}

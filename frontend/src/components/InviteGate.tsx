import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { hideLanding, rememberGate, showLanding } from '../lib/landing';
import { PolicyPage } from '../pages/Policy';
import { TermsPage } from '../pages/Terms';

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

  /**
   * The two documents the law puts in front of the gate rather than behind it
   * (GOI-95): they are readable whether or not the visitor has an invite.
   *
   * Art. 8(1)(1) of the ustawa o świadczeniu usług drogą elektroniczną
   * requires the regulamin to be available to a user *before* they conclude a
   * contract for the service, and art. 12–13 RODO says the same of the privacy
   * notice. They are what someone reads to decide whether to ask for an
   * invitation at all, so a gate in front of them would mean the only people
   * who can read the terms are the ones who already accepted them.
   */
  const legal = isLegalPath(currentPath());

  // Before paint, not after: the app has just been committed into `#root`,
  // which the landing page's stylesheet keeps collapsed while the landing is
  // up. Deferring this to a passive effect would paint one blank frame.
  useLayoutEffect(() => {
    if (state === 'checking') return;
    const open = state === 'open';
    // The curtain comes down for the legal pages too — they are rendered into
    // `#root`, and the landing page would otherwise sit on top of them.
    if (open || legal) hideLanding();
    else showLanding();
    rememberGate(open);
  }, [state, legal]);

  if (state === 'checking') return null;
  if (state === 'open') return <>{children}</>;
  // Closed. Everything but those two paths is the landing page's business, and
  // the landing page is already in the document — so there is nothing to draw.
  return legal ? <LegalOnly /> : null;
}

const LEGAL_PATHS = ['/policy', '/terms'] as const;

/** The path within the app, with the deploy's base ("/afisz/dev") removed —
 *  the previews are served from a subdirectory, so the raw pathname is not it. */
function currentPath(): string {
  if (typeof window === 'undefined') return '/';
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = window.location.pathname;
  const withinApp = base && path.startsWith(base) ? path.slice(base.length) : path;
  return (withinApp || '/').replace(/\/$/, '') || '/';
}

function isLegalPath(path: string): boolean {
  return (LEGAL_PATHS as readonly string[]).includes(path);
}

/**
 * A router carrying those two routes and nothing else.
 *
 * It is needed because the pages link to each other, and a `<Link>` outside a
 * router throws. It is deliberately *not* `<App />`: that would put the whole
 * route table in front of the gate, which is the one thing this branch must
 * not do. Both pages are static prose and fire no queries, which is what lets
 * them render with no tRPC provider above them.
 */
function LegalOnly() {
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '');
  return (
    <BrowserRouter basename={basename || '/'}>
      <Routes>
        <Route path="/policy" element={<PolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Routes>
    </BrowserRouter>
  );
}

import { LANDING_ID } from '../landing/id.js';

/**
 * Showing and hiding the static landing page (`src/landing/render.ts`).
 *
 * The landing page is served in `index.html`, outside `#root`, so that it is
 * readable without JavaScript. React therefore cannot render it away — it can
 * only draw the curtain. That is what these three lines do.
 *
 * Every function tolerates the element being absent: the app's unit tests
 * mount components into a bare document, and nothing here is important enough
 * to fail a render over.
 */

/** Remembers the last answer from the invite gate. Not a credential — the
 *  server re-checks the cookie on every request — only a hint used to skip a
 *  flash of the landing page for someone who was let in last time. */
const GATE_KEY = 'afisz-gate-open';

function element(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById(LANDING_ID);
}

export function hideLanding(): void {
  element()?.setAttribute('hidden', '');
}

export function showLanding(): void {
  element()?.removeAttribute('hidden');
}

/** Is the landing page currently on screen? Exists for the tests. */
export function landingVisible(): boolean {
  const el = element();
  return !!el && !el.hasAttribute('hidden');
}

export function rememberGate(open: boolean): void {
  try {
    if (open) localStorage.setItem(GATE_KEY, '1');
    else localStorage.removeItem(GATE_KEY);
  } catch {
    // Private mode. The gate still works; the visitor just sees the landing
    // page for the moment the check takes.
  }
}

export function gateWasOpen(): boolean {
  try {
    return localStorage.getItem(GATE_KEY) === '1';
  } catch {
    return false;
  }
}

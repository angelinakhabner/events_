import { LANDING_ID } from '../landing/id.js';

/**
 * Hiding the static landing page (`src/landing/render.ts`).
 *
 * The landing page is served in `index.html`, outside `#root`, so that it is
 * readable without JavaScript. React therefore cannot render it away — it can
 * only draw the curtain. That is what these two lines do.
 *
 * The curtain used to go up and down with the invite gate's answer. The site
 * is open now, so it only ever goes up, once, before the app is rendered: the
 * landing page is what a crawler and a JavaScript-less reader get, and the app
 * is what everyone else gets.
 *
 * Every function tolerates the element being absent: the app's unit tests
 * mount components into a bare document, and nothing here is important enough
 * to fail a render over.
 */

function element(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById(LANDING_ID);
}

export function hideLanding(): void {
  element()?.setAttribute('hidden', '');
}

/** Is the landing page currently on screen? Exists for the tests. */
export function landingVisible(): boolean {
  const el = element();
  return !!el && !el.hasAttribute('hidden');
}

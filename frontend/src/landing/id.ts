/**
 * The id of the static landing page's wrapper element.
 *
 * Its own module so that `src/lib/landing.ts` — which runs in the browser and
 * only needs to find the element — does not have to import the renderer and
 * drag the whole page's markup and stylesheet into the app bundle.
 */
export const LANDING_ID = 'landing';

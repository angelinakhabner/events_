/**
 * The public landing page, rendered to a string of HTML.
 *
 * This is the one page of this site that is meant to be read by strangers and
 * by search engines, which is why it is static HTML rather than a React route.
 * `vite.config.ts` calls into here at build time and injects the result into
 * `index.html`, so the page is complete in the served document: it needs no
 * JavaScript, no API call and no round trip to the invite gate before a
 * crawler — or a person on a slow connection — can read a word of it.
 *
 * It is deliberately self-contained. The styles below are inlined rather than
 * pulled from the Tailwind bundle (which only exists once the app's JS has
 * loaded) and there is no webfont link, so the page fetches nothing from
 * anywhere. That is what lets the policy it carries say so.
 *
 * The markup lives outside `#root`. React never owns it; the two gates decide
 * whether it stays on screen (see `src/lib/landing.ts`).
 */

import {
  ACCESS_BLOCKS,
  ACCESS_HEADING,
  CONTACT_BLOCKS,
  CONTACT_EMAIL,
  CONTACT_HEADING,
  DESCRIPTION,
  META_DESCRIPTION,
  NAME,
  POLICY_HEADING,
  POLICY_SECTIONS,
  POLICY_UPDATED,
  SITE_URL,
  TAGLINE,
  TERMS_HEADING,
  TERMS_SECTIONS,
  TERMS_UPDATED,
  type PolicyBlock,
  type PolicySection,
} from './content.js';
import { LANDING_ID } from './id.js';

export { LANDING_ID };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape prose, then expand the `{email}` placeholder into a real mailto link.
 *
 * The order matters: escaping first means nothing an author writes can inject
 * markup, and the anchor is assembled here from a constant rather than from
 * anything in the copy.
 */
export function prose(text: string): string {
  const link = `<a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>`;
  return escapeHtml(text).split('{email}').join(link);
}

function paragraph(text: string): string {
  return `<p>${prose(text)}</p>`;
}

function block(b: PolicyBlock): string {
  if (b.kind === 'p') return paragraph(b.text);
  return `<ul>${b.items.map((item) => `<li>${prose(item)}</li>`).join('')}</ul>`;
}

/**
 * One document's sections as HTML. Both the policy and the terms are the same
 * shape and get the same treatment; `prefix` keeps their anchors apart, since
 * both have a section called "Complaints".
 */
function documentSections(sections: readonly PolicySection[], prefix: string): string {
  return sections
    .map(
      (section) => `
        <section class="afisz-policy-section" id="${escapeHtml(prefix)}-${escapeHtml(slug(section.heading))}">
          <h3>${escapeHtml(section.heading)}</h3>
          ${section.blocks.map(block).join('\n          ')}
        </section>`,
    )
    .join('');
}

/**
 * A stable slug for a section heading, so the policy's parts are linkable.
 * Headings are short, hand-written English; anything outside a-z collapses to
 * a hyphen and repeats are squeezed.
 */
export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Structured data, so a crawler is told what this is rather than guessing.
 * `JSON.stringify` cannot emit `<`, but a `</script>` sequence inside a string
 * would still end the block early, so the slash is escaped.
 */
function jsonLd(): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: NAME,
    url: SITE_URL,
    description: META_DESCRIPTION,
    inLanguage: 'en',
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/**
 * The head of the document: title, description, and the social card. Returned
 * as a list of raw tags for Vite's `transformIndexHtml`.
 *
 * `noindex` is passed for the password-gated /dev/ preview build, which ships
 * the same markup and must not compete with the real page in search results.
 */
export function landingHead({ noindex = false }: { noindex?: boolean } = {}): string[] {
  const title = `${NAME} — ${TAGLINE}`;
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(META_DESCRIPTION)}">`,
    noindex
      ? '<meta name="robots" content="noindex, nofollow">'
      : '<meta name="robots" content="index, follow">',
    `<link rel="canonical" href="${escapeHtml(SITE_URL)}/">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${escapeHtml(NAME)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(META_DESCRIPTION)}">`,
    `<meta property="og:url" content="${escapeHtml(SITE_URL)}/">`,
    '<meta name="twitter:card" content="summary">',
    jsonLd(),
  ];
}

/** The page itself: masthead, what it is, the invitation note, contact, policy. */
export function landingBody(): string {
  const policy = documentSections(POLICY_SECTIONS, 'privacy');
  const terms = documentSections(TERMS_SECTIONS, 'terms');

  return `
    <div class="afisz-landing-inner">
      <header class="afisz-masthead">
        <p class="afisz-wordmark">${escapeHtml(NAME)}<span class="afisz-square" aria-hidden="true"></span></p>
        <p class="afisz-tagline">${escapeHtml(TAGLINE)}</p>
      </header>

      <main>
        <section class="afisz-section" id="what-it-is">
          <h1 class="afisz-h1">What ${escapeHtml(NAME)} is</h1>
          ${paragraph(DESCRIPTION)}
        </section>

        <section class="afisz-section afisz-note" id="access">
          <h2 class="afisz-h2">${escapeHtml(ACCESS_HEADING)}</h2>
          ${ACCESS_BLOCKS.map(paragraph).join('\n          ')}
        </section>

        <section class="afisz-section" id="contact">
          <h2 class="afisz-h2">${escapeHtml(CONTACT_HEADING)}</h2>
          ${CONTACT_BLOCKS.map(paragraph).join('\n          ')}
        </section>

        <section class="afisz-section" id="privacy">
          <h2 class="afisz-h2">${escapeHtml(POLICY_HEADING)}</h2>
          <p class="afisz-updated">Last updated ${escapeHtml(POLICY_UPDATED)}</p>
          ${policy}
        </section>

        <!-- GOI-95: the regulamin belongs on the page a stranger reads, not
             only behind the invite. Art. 8(1)(1) UŚUDE requires it to be
             available *before* the service is used, and for someone who has
             not been invited yet, this page is before. -->
        <section class="afisz-section" id="terms">
          <h2 class="afisz-h2">${escapeHtml(TERMS_HEADING)}</h2>
          <p class="afisz-updated">Last updated ${escapeHtml(TERMS_UPDATED)}</p>
          ${terms}
        </section>
      </main>

      <footer class="afisz-footer">
        <p>${escapeHtml(NAME)} · <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a> · <a href="#privacy">Privacy</a> · <a href="#terms">Terms</a></p>
      </footer>
    </div>`;
}

/**
 * Inline styles for the page above, in the same poster palette as the app
 * (one ink, one paper, one red — see `tailwind.config.js`). Anton is the app's
 * display face; it is named first so it is used when the browser already has
 * it, and falls back to a condensed system face rather than being fetched.
 */
export const LANDING_CSS = `
#${LANDING_ID} {
  --ink: #141414; --paper: #eae6df; --panel: #f4f1ea;
  --accent: #c62828; --muted: #6b6660; --body: #3a3632; --rule: #cfc9bf;
  background: var(--paper);
  color: var(--body);
  font-family: Archivo, ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 17px;
  line-height: 1.6;
  min-height: 100%;
}
#${LANDING_ID}[hidden] { display: none; }
#${LANDING_ID} .afisz-landing-inner { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
#${LANDING_ID} a { color: var(--ink); text-underline-offset: 2px; }
#${LANDING_ID} a:hover { color: var(--accent); }
#${LANDING_ID} .afisz-masthead { border-bottom: 5px solid var(--ink); padding-bottom: 1.25rem; margin-bottom: 2rem; }
#${LANDING_ID} .afisz-wordmark {
  font-family: Anton, Impact, 'Arial Narrow', ui-sans-serif, sans-serif;
  font-weight: 400; letter-spacing: 1px; text-transform: uppercase;
  font-size: clamp(2.25rem, 9vw, 3.5rem); line-height: 1; color: var(--ink); margin: 0;
}
#${LANDING_ID} .afisz-square { display: inline-block; width: 0.22em; height: 0.22em; background: var(--accent); margin-left: 0.14em; vertical-align: baseline; }
#${LANDING_ID} .afisz-tagline { margin: 0.75rem 0 0; font-size: 1.0625rem; color: var(--muted); }
#${LANDING_ID} .afisz-section { margin: 0 0 3rem; }
#${LANDING_ID} .afisz-h1, #${LANDING_ID} .afisz-h2 {
  font-family: Anton, Impact, 'Arial Narrow', ui-sans-serif, sans-serif;
  font-weight: 400; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--ink); border-top: 3px solid var(--ink); padding-top: 0.75rem; margin: 0 0 1rem;
}
#${LANDING_ID} .afisz-h1 { font-size: 1.75rem; }
#${LANDING_ID} .afisz-h2 { font-size: 1.4375rem; }
#${LANDING_ID} #what-it-is .afisz-h1 { border-top: 0; padding-top: 0; }
#${LANDING_ID} .afisz-note { background: var(--panel); border-left: 5px solid var(--accent); padding: 1.25rem 1.25rem 0.25rem; }
#${LANDING_ID} .afisz-note .afisz-h2 { border-top: 0; padding-top: 0; color: var(--accent); }
#${LANDING_ID} p { margin: 0 0 1rem; }
#${LANDING_ID} .afisz-updated { font-size: 0.75rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); margin-top: -0.5rem; }
#${LANDING_ID} .afisz-policy-section { margin: 1.75rem 0 0; }
#${LANDING_ID} .afisz-policy-section h3 {
  font-size: 0.8125rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;
  color: var(--ink); margin: 0 0 0.5rem; border-bottom: 2px solid var(--rule); padding-bottom: 0.375rem;
}
#${LANDING_ID} ul { margin: 0 0 1rem; padding-left: 1.125rem; }
#${LANDING_ID} li { margin: 0 0 0.625rem; }
#${LANDING_ID} .afisz-footer { border-top: 3px solid var(--ink); padding-top: 1rem; font-size: 0.8125rem; color: var(--muted); }
#${LANDING_ID} .afisz-footer a { color: var(--muted); }
`;

/**
 * While the landing page is on screen the app's mount point must not reserve
 * space: `index.css` gives `#root` `height: 100%`, which would otherwise hang
 * an empty screenful under the footer. The moment either gate hides the
 * landing, this stops applying and `#root` takes over.
 */
export const LANDING_ROOT_CSS = `#${LANDING_ID}:not([hidden]) ~ #root { display: none; }`;

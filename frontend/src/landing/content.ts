/**
 * The copy for the public landing page (frontend/src/landing/render.ts).
 *
 * Plain data, deliberately: this module is imported by `vite.config.ts` and
 * rendered to static HTML at build time, so it must stay free of React, of
 * the DOM, and of anything that only exists in a browser.
 *
 * It is also the only place this copy lives. The page a stranger sees, the
 * `<meta name="description">` a crawler reads and the privacy policy are all
 * generated from here, so they cannot drift apart.
 *
 * `{email}` in any string is replaced by a mailto link to CONTACT_EMAIL when
 * the page is rendered. Everything else is escaped — write prose, not markup.
 */

/** The product name, as it is written everywhere outside the app chrome. */
export const NAME = 'AFISZ.KA';

/**
 * Where invite requests and privacy requests land. This is the address the
 * deployment already sends transactional mail from (see docs/RUNBOOK.md); the
 * policy below promises a human answers it, so it must be able to receive.
 */
export const CONTACT_EMAIL = 'hello@afisz.cc';

export const SITE_URL = 'https://afisz.cc';

/** Shown under the wordmark, and used as the page's `og:title` suffix. */
export const TAGLINE = 'A cultural events aggregator you assemble yourself.';

/**
 * The one-paragraph answer to "what is this". Also the meta description,
 * trimmed to its first sentence and a half — see `metaDescription()`.
 */
export const DESCRIPTION = `${NAME} is a cultural events aggregator you build for yourself, one venue at a time. Rather than browsing a city listings site and hoping it happens to cover what you care about, you point ${NAME} at the places you actually go — a cinema, an art-house theatre, a gallery, a concert hall, anywhere that publishes a programme on the web — and it reads their schedules for you, turning loose pages of listings into events you can filter. Venues gather into named lists, one per city or per mood, each remembering its own filters for category, time, price and day. From there you can mark what you want to go to, share that shortlist with the person you want to go with, drop a screening straight into your calendar, and have a brief of what is coming up arrive by email on the morning you choose.`;

/** The invitation note. Not buried: it is a section of its own on the page. */
export const ACCESS_HEADING = 'Access is by invitation';
export const ACCESS_BLOCKS: readonly string[] = [
  `${NAME} is in closed testing. There is no public sign-up, and no way to create an account from this page — the app opens only for a browser holding a working invite link, and every part of it, down to the last data request, is closed without one.`,
  `If you would like an invitation, write to {email} and say a little about which city and which venues you would want to follow. Invitations go out in small batches while the app is still being built.`,
];

export const CONTACT_HEADING = 'Contact';
export const CONTACT_BLOCKS: readonly string[] = [
  `Invitations, questions, a venue whose programme page is being read wrongly, or anything about the policy below: {email}.`,
];

export const POLICY_HEADING = 'Privacy policy';
export const POLICY_UPDATED = '21 August 2026';

export type PolicyBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: readonly string[] };

export interface PolicySection {
  heading: string;
  blocks: readonly PolicyBlock[];
}

/**
 * The policy describes what the code in this repository actually does. Each
 * claim is checkable: the collected data is the schema in
 * `backend/src/db/schema.ts`, the processors are the services in
 * `backend/src/services/`, and the "no analytics" claim is the absence of any
 * tracking script in this bundle. Changing any of those means changing this.
 */
export const POLICY_SECTIONS: readonly PolicySection[] = [
  {
    heading: 'Who this is',
    blocks: [
      {
        kind: 'p',
        text: `${NAME} is a small, independently run project, not a company. It is reachable at {email}, which is also the address to use for anything in this policy.`,
      },
      {
        kind: 'p',
        text: 'This page you are reading now is a plain static document. It loads no fonts, scripts, images or styles from anywhere else, sets no cookies, and stores nothing in your browser. Reading it leaves no trace with us beyond the ordinary web-server log kept by GitHub Pages, which serves it.',
      },
    ],
  },
  {
    heading: 'What the app collects, and why',
    blocks: [
      {
        kind: 'p',
        text: 'Nothing below applies until you accept an invitation and start using the app. Everything it stores is something you typed or asked for; there is no profile built from your behaviour.',
      },
      {
        kind: 'list',
        items: [
          'Your email address, if you sign in. It is the account — there is no password. Signing in sends a single-use link to that address; only a hash of the link is kept, and only until it is used or expires.',
          'The venues you add, the lists you group them into, any names, categories or personal tags you override them with, and the filters each list remembers. This is the substance of the app.',
          'The events you mark as "want to go", and any shortlist you choose to share. A shared shortlist becomes readable by anyone holding the link you send, which is what sharing means; you can stop sharing it at any time.',
          'Your email brief settings, if you subscribe to one: the address it goes to, the name it should greet you by, which venues and categories it covers, and what time it should arrive.',
          'A random identifier kept in your browser’s local storage, so that things you save before signing in are still yours afterwards. It is a random value with no meaning of its own and is never combined with anything bought or received from elsewhere.',
          'An invite cookie, set when you follow an invitation link, so you are not asked for it again on every visit. It carries the invite token and nothing else, and it is how the site knows to open at all.',
          'Access to a Google Drive folder, only if you explicitly connect one so that briefs are filed there as PDFs. That connection stores a Google refresh token and the address of the account you connected. Disconnecting it deletes both.',
        ],
      },
    ],
  },
  {
    heading: 'What is never collected',
    blocks: [
      {
        kind: 'p',
        text: 'There is no advertising anywhere in this project and no advertising technology in it. No analytics package, no tracking pixel, no session recorder, no fingerprinting, no third-party cookie. Your data is not sold, rented, or handed to data brokers, and it is not used to train machine-learning models.',
      },
    ],
  },
  {
    heading: 'Who else sees it',
    blocks: [
      {
        kind: 'p',
        text: 'Running the app means using a few other services. Each sees only the part it needs to do its job, and none of them are given anything to use for their own purposes:',
      },
      {
        kind: 'list',
        items: [
          'Railway hosts the application server and its Postgres database, so the data described above physically lives there.',
          'GitHub Pages serves the site you are looking at, and keeps the usual server-side access logs.',
          'Resend delivers email — sign-in links and the brief — and therefore handles the recipient address and the message.',
          'Anthropic’s Claude models read the venue programme pages we fetch, in order to turn them into structured events. What is sent is the public web page of a venue. Your account, your lists and your saved events are not part of it.',
          'Google, only if you sign in with Google or connect a Drive folder, and only for what that requires.',
        ],
      },
    ],
  },
  {
    heading: 'How long it is kept',
    blocks: [
      {
        kind: 'p',
        text: 'Your account and the things in it are kept for as long as the account exists, because they are the thing the app is for. Sign-in links expire quickly and are single-use. Sessions expire on their own. Invitations can be revoked, and a revoked invitation stops working immediately — the cookie is re-checked against the invite on every single request rather than trusted once. Ask for deletion and the account and everything attached to it goes, including any brief subscription and any Drive connection.',
      },
    ],
  },
  {
    heading: 'Your rights',
    blocks: [
      {
        kind: 'p',
        text: 'You can ask what is held about you, ask for a copy of it, ask for it to be corrected, or ask for all of it to be deleted. Write to {email} from the address you signed in with, and expect a reply from a person rather than a form. Every brief also carries its own unsubscribe, which needs no email to us at all.',
      },
    ],
  },
  {
    heading: 'Changes',
    blocks: [
      {
        kind: 'p',
        text: `This policy is versioned with the application it describes, and its history is public. It was last changed on ${POLICY_UPDATED}. If it changes in a way that affects anyone already using the app, the change is sent to them by email rather than quietly published here.`,
      },
    ],
  },
];

/**
 * The `<meta name="description">`. Search results truncate around 155
 * characters, so this is written to stand alone rather than sliced out of the
 * paragraph above and cut mid-clause.
 */
export const META_DESCRIPTION = `${NAME} is a cultural events aggregator you assemble yourself: follow the cinemas, theatres and galleries you actually go to, filter what is on, and get a brief by email. Access by invitation.`;

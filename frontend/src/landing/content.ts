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

/**
 * The controller's registered identity (GOI-95).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * FILL THESE IN BEFORE THE SITE OPENS TO THE PUBLIC.
 *
 * Polish law names them specifically, and a policy without them is not merely
 * thin — it is non-compliant. Art. 13(1)(a) RODO requires the controller's
 * identity and contact details in the privacy notice, and art. 8(1)(1) of the
 * ustawa o świadczeniu usług drogą elektroniczną requires the service
 * provider's identifying details in the regulamin. Both documents and both
 * surfaces that render them read from here, so this is the only edit needed.
 * ───────────────────────────────────────────────────────────────────────────
 */
export const OPERATOR_ENTITY = '';
/** Registered address for correspondence. */
export const OPERATOR_ADDRESS = '';

/** How the operator is named in prose while the two fields above are blank. */
export function operatorIdentity(): string {
  if (!OPERATOR_ENTITY.trim()) return `the operator of ${NAME}`;
  return OPERATOR_ADDRESS.trim()
    ? `${OPERATOR_ENTITY}, ${OPERATOR_ADDRESS}`
    : OPERATOR_ENTITY;
}

/**
 * Poland's data-protection authority, which art. 13(2)(d) RODO requires the
 * notice to name as the body a reader may complain to.
 *
 * `host` carries no scheme on purpose. This copy is rendered into the static
 * landing page, whose own policy promises the page fetches nothing from
 * anywhere else — and `render.test.ts` enforces that by rejecting any
 * `https://` in the markup at all, rather than trying to tell a link apart
 * from a URL merely quoted in prose. A bare host is just as useful to a reader
 * and keeps that guard as blunt as it should be.
 */
export const DPA = {
  name: 'Prezes Urzędu Ochrony Danych Osobowych',
  address: 'ul. Stawki 2, 00-193 Warszawa',
  host: 'uodo.gov.pl',
} as const;

export const POLICY_HEADING = 'Privacy policy';
export const POLICY_UPDATED = '29 August 2026';

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
        text: `${NAME} is a small, independently run project. The controller of the personal data described below — the administrator danych osobowych, in the words of the Polish implementation of the GDPR — is ${operatorIdentity()}, reachable at {email}, which is also the address to use for anything in this policy. No data protection officer has been appointed, as art. 37 GDPR does not require one for processing of this kind; that address reaches the controller directly.`,
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
        kind: 'p',
        text: 'The GDPR requires each purpose to rest on a stated legal basis, so here they are. Your account, your lists and everything you save are processed under art. 6(1)(b) — performing the contract you entered into by accepting an invitation. The email brief and a connected Drive folder rest on art. 6(1)(a), your consent, which you can withdraw at any time without affecting anything done before you did. The pre-sign-in browser identifier and the ordinary server logs rest on art. 6(1)(f), the legitimate interest in the app working before you have an account and in keeping the service running and free of abuse. No special categories of data (art. 9) are processed, and the app is not directed at children under 16.',
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
      {
        kind: 'p',
        text: 'Nothing here makes automated decisions producing legal or similarly significant effects, and nobody is profiled, within the meaning of art. 22 GDPR. What the app shows you is what you asked it to follow.',
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
    heading: 'Where it goes outside Europe',
    blocks: [
      {
        kind: 'p',
        text: 'Some of the services above are established in the United States. Where personal data reaches them, the transfer rests on the European Commission’s adequacy decision of 10 July 2023 for the EU–US Data Privacy Framework where the provider is certified under it, and otherwise on the Standard Contractual Clauses adopted by the Commission under art. 46(2)(c) GDPR. Ask at {email} for the safeguards covering a particular transfer and you will be sent them.',
      },
    ],
  },
  {
    heading: 'Cookies and what is kept in your browser',
    blocks: [
      {
        kind: 'p',
        text: 'There is no cookie banner because there is nothing to ask consent for. No advertising or analytics cookie is set anywhere. What is stored on your device is strictly necessary to provide the service you asked for, which art. 173(3) of the Polish Prawo telekomunikacyjne exempts from the consent requirement:',
      },
      {
        kind: 'list',
        items: [
          'a session token in local storage, so you stay signed in;',
          'a random device identifier in local storage, so a list survives a reload before you have an account;',
          'a note of whether the invite gate last let you in, so a returning visitor is not shown the public page for a moment before the app appears;',
          'the invite cookie itself, set on the API when you follow an invitation link.',
        ],
      },
      {
        kind: 'p',
        text: 'Clearing this site’s data in your browser removes all of them. Doing so signs you out and detaches anything saved without an account.',
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
      {
        kind: 'p',
        text: 'Named as the GDPR names them, those rights are: access and a copy (art. 15), rectification (art. 16), erasure (art. 17), restriction of processing (art. 18), portability in a machine-readable form (art. 20), objection to anything done on the basis of legitimate interest (art. 21), and withdrawal of any consent you have given (art. 7(3)). A request is answered within one month, as art. 12(3) requires.',
      },
    ],
  },
  {
    heading: 'Complaints',
    blocks: [
      {
        kind: 'p',
        text: `A complaint is worth making to {email} first, because it can usually be fixed there. You also have the right to complain to the supervisory authority, which in Poland is the ${DPA.name}, ${DPA.address}, whose site is ${DPA.host}.`,
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
 * The terms of use — the *regulamin* (GOI-95).
 *
 * Art. 8(1)(1) of the ustawa o świadczeniu usług drogą elektroniczną obliges
 * anyone providing a service by electronic means to make terms available free
 * of charge, in a form the user can obtain, reproduce and store, *before* they
 * use the service. Art. 8(3) fixes the minimum contents: the services offered,
 * the technical requirements, the prohibition on supplying unlawful content,
 * and the complaints procedure. There is a section for each.
 *
 * The consumer clauses are not decoration either. The app is free, but a free
 * digital service supplied in exchange for personal data is still within the
 * ustawa o prawach konsumenta as amended in 2023 — which is why the
 * fourteen-day withdrawal right is stated rather than disclaimed.
 */
export const TERMS_HEADING = 'Terms of use';
export const TERMS_UPDATED = '29 August 2026';

export const TERMS_SECTIONS: readonly PolicySection[] = [
  {
    heading: 'Who provides the service',
    blocks: [
      {
        kind: 'p',
        text: `${NAME} is provided by ${operatorIdentity()} (the “Provider”), contactable at {email}. These terms are made available free of charge before you use the service, in a form you can display, copy and store, as art. 8(1)(1) of the ustawa o świadczeniu usług drogą elektroniczną requires.`,
      },
    ],
  },
  {
    heading: 'What the service does',
    blocks: [
      {
        kind: 'p',
        text: `${NAME} reads programme information that cultural venues publish on their own websites and presents it as one listing. Free of charge, and by invitation, it lets you:`,
      },
      {
        kind: 'list',
        items: [
          'browse and filter what is on;',
          'follow the venues you choose and group them into named lists;',
          'keep a “want to go” shortlist and share it by link;',
          'add an event to your calendar;',
          'subscribe to an email brief of what is coming up at your venues;',
          'optionally connect one Google Drive folder, so each brief is filed there as a PDF.',
        ],
      },
      {
        kind: 'p',
        text: `There is no charge for any of it and nothing to buy. ${NAME} does not sell tickets, take bookings, or act as an intermediary between you and any venue.`,
      },
    ],
  },
  {
    heading: 'What you need to use it',
    blocks: [
      {
        kind: 'p',
        text: 'A device with internet access and a current version of a standard web browser (Chrome, Firefox, Safari or Edge) with JavaScript and local storage enabled, plus a working invitation. An email address is needed for an account or a brief, and nothing else is.',
      },
      {
        kind: 'p',
        text: 'Using the internet carries the ordinary risks of doing so — interception in transit, malware, and messages that claim to come from a service and do not. Sign-in links are sent from a verified domain, and you will never be asked for a password, because the service has none.',
      },
    ],
  },
  {
    heading: 'Your account',
    blocks: [
      {
        kind: 'p',
        text: 'You sign in with a single-use link sent to your email address, or with a Google account. No password is held. Anyone with access to your mailbox can therefore sign in as you: keep it secure, and write to {email} if you believe your account has been used by someone else.',
      },
      {
        kind: 'p',
        text: 'You may close your account at any time, for any reason, by writing to that address. Closing it deletes your lists, your brief and any Drive connection.',
      },
    ],
  },
  {
    heading: 'The email brief',
    blocks: [
      {
        kind: 'p',
        text: 'The brief is sent only if you ask for it, which under art. 10 of the ustawa o świadczeniu usług drogą elektroniczną is your consent to receive commercial information by electronic means. You can withdraw that consent at any time — from the unsubscribe link in every message, or by switching the brief off in your account — and it takes effect immediately. The brief reports what the venues have published; it carries no advertising.',
      },
    ],
  },
  {
    heading: 'How you may use it',
    blocks: [
      {
        kind: 'p',
        text: 'Use the service lawfully and in a way that does not degrade it for others. You must not supply unlawful content — a prohibition art. 8(3)(2)(b) of that Act requires these terms to state — and in particular you must not:',
      },
      {
        kind: 'list',
        items: [
          'submit content that is unlawful, infringes anyone’s rights, or is designed to mislead;',
          'give a venue a name or tag that is defamatory, or that impersonates a real organisation;',
          'attempt to reach another user’s account, or parts of the service not made available to you;',
          'pass your invitation to someone it was not meant for;',
          'scrape, overload or otherwise interfere with the service, or work around its technical limits;',
          'use the service to send unsolicited commercial messages.',
        ],
      },
      {
        kind: 'p',
        text: 'Where content you supply is unlawful, it may be removed and the account responsible suspended, in accordance with art. 14 of that Act and the Digital Services Act.',
      },
    ],
  },
  {
    heading: 'Accuracy of the listings',
    blocks: [
      {
        kind: 'p',
        text: `The listings are read from venues’ own websites, automatically. Programmes change, screenings are cancelled, and a page can be misread. ${NAME} therefore presents this information for orientation, not as a guarantee, and the venue’s own site is always the authority. Check with the venue before you set out — every listing links to its source for exactly that reason.`,
      },
      {
        kind: 'p',
        text: 'A wrong or missing listing is worth reporting to {email}, and reports are acted on.',
      },
    ],
  },
  {
    heading: 'Rights in the content',
    blocks: [
      {
        kind: 'p',
        text: 'The design, the code and the wording of the service belong to the Provider. Programme information, titles, descriptions and images belong to the venues and to the rights holders in the works described, and appear here for the purpose of informing you what is on.',
      },
      {
        kind: 'p',
        text: 'Anything you enter — a list name, a tag, your own name for a venue — stays yours. The Provider is granted only the permission needed to store it, show it back to you, and show it to anyone you deliberately share a shortlist with.',
      },
    ],
  },
  {
    heading: 'Complaints',
    blocks: [
      {
        kind: 'p',
        text: 'Complaints about the service go to {email}. Describe the problem, when it happened, and the address you use with the service. A complaint is answered within 14 days of being received; if it is not answered within that period, it is taken to have been accepted as submitted.',
      },
    ],
  },
  {
    heading: 'If you are a consumer',
    blocks: [
      {
        kind: 'p',
        text: 'The service is free, but it is supplied to you as a digital service and Polish consumer law applies to it. You may withdraw from the contract within 14 days of creating your account, without giving a reason and at no cost, by writing to {email}. In practice, closing your account does the same thing at any time.',
      },
      {
        kind: 'p',
        text: 'Nothing in these terms limits any right you have under the ustawa o prawach konsumenta or the Kodeks cywilny. Where a clause here conflicts with those rights, the law prevails and the clause does not apply to you. You may also use out-of-court dispute resolution, including the consumer ombudsman — the miejski lub powiatowy rzecznik konsumentów — and the Inspekcja Handlowa; neither side is obliged to.',
      },
    ],
  },
  {
    heading: 'Liability and availability',
    blocks: [
      {
        kind: 'p',
        text: 'The Provider is liable for damage caused by failing to perform or improperly performing these terms, on the general principles of the Kodeks cywilny. Liability is not excluded or limited for wilful misconduct, nor for harm to life or health, nor — where you are a consumer — in any way the law forbids.',
      },
      {
        kind: 'p',
        text: 'The service is in closed testing and is offered as it stands, without a guaranteed level of availability. It may be interrupted for maintenance, and it may be discontinued. If it is discontinued, account holders will be given reasonable notice by email so that anything worth keeping can be exported first.',
      },
    ],
  },
  {
    heading: 'Changes to these terms',
    blocks: [
      {
        kind: 'p',
        text: `These terms may change — when a feature is added, or when the law does. Account holders are told by email at least 14 days before a change takes effect, and may close their account before then if they do not accept it. Continuing to use the service after that means accepting it. They were last changed on ${TERMS_UPDATED}.`,
      },
    ],
  },
  {
    heading: 'Governing law',
    blocks: [
      {
        kind: 'p',
        text: 'These terms are governed by Polish law. If you are a consumer resident elsewhere in the EU, this does not deprive you of the protection of the mandatory rules of your own country’s law. Disputes are heard by the courts having jurisdiction under the Kodeks postępowania cywilnego. How your personal data is handled is set out in the privacy policy.',
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

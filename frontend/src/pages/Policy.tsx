import { Link } from 'react-router-dom';
import { Bullets, Clause, LegalPage, Row } from '../components/LegalPage';
import { DPA, LEGAL_DETAILS_COMPLETE, LEGAL_UPDATED, OPERATOR } from '../lib/legal';

/**
 * /policy — the privacy notice (GOI-95), written against Polish law: RODO
 * (GDPR as applied in Poland, with the ustawa o ochronie danych osobowych of
 * 10 May 2018) and the ustawa o świadczeniu usług drogą elektroniczną.
 *
 * It describes what this application actually does, clause by clause, rather
 * than the superset a template would cover. AFISZ runs no advertising, no
 * analytics and no third-party trackers, and the notice says so plainly —
 * "we may share your data with partners" written by a service that shares
 * nothing is not caution, it is a false statement about the reader's own data.
 *
 * The processors named here are the ones in `backend/src/config.ts`. If a new
 * one is added — another mail sender, an analytics package, a payment
 * provider — section 4 has to gain a row in the same commit.
 */
export function PolicyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated={LEGAL_UPDATED}
      intro={`How ${OPERATOR.service} handles your personal data, under the GDPR (RODO) and Polish law. In short: an email address to sign you in, whatever you choose to save, and nothing sold, profiled or advertised against.`}
    >
      <Clause n="1" title="Who is responsible for your data">
        <p>
          The controller (<em>administrator danych osobowych</em>) of personal data processed
          through {OPERATOR.service} is{' '}
          {LEGAL_DETAILS_COMPLETE ? (
            <>
              <strong className="text-ink">{OPERATOR.entity}</strong>, {OPERATOR.address}
            </>
          ) : (
            <strong className="text-ink">the operator of {OPERATOR.service}</strong>
          )}
          .
        </p>
        <p>
          For anything in this policy — a question, a request under section 7, or a complaint —
          write to{' '}
          <a href={`mailto:${OPERATOR.email}`} className="underline hover:text-accent">
            {OPERATOR.email}
          </a>
          . No data protection officer (<em>inspektor ochrony danych</em>) has been appointed, as
          none is required under art. 37 GDPR for processing of this kind; that address reaches the
          controller directly.
        </p>
      </Clause>

      <Clause n="2" title="What we collect, and why">
        <p>
          Each row below is a purpose, the data it needs, and the legal basis under art. 6(1) GDPR.
          Nothing is collected “just in case”.
        </p>
        <div className="mt-4">
          <Row term="Signing in">
            Your email address, and a hashed sign-in token that expires after 15 minutes and works
            once. If you use “Sign in with Google”, Google tells us your email address and nothing
            else — we do not receive your password. Basis: art. 6(1)(b), performance of the contract
            (giving you an account you asked for).
          </Row>
          <Row term="Keeping you signed in">
            A session token, stored hashed on the server and in your browser&rsquo;s local storage.
            Basis: art. 6(1)(b).
          </Row>
          <Row term="Your lists">
            The venues you follow, any names or tags you give them, your folders, and your “want to
            go” list. Basis: art. 6(1)(b).
          </Row>
          <Row term="Lists before you sign in">
            A random device identifier generated in your browser, so a list you build before signing
            in is still there afterwards. It is not derived from your device, contains nothing about
            you, and is not combined with any other source. Basis: art. 6(1)(f), our legitimate
            interest in the service working before you have an account.
          </Row>
          <Row term="The email brief">
            Your email address, an optional first name, and the settings you choose — which venues,
            how often, at what time. Basis: art. 6(1)(a), your consent, which you may withdraw at any
            time (section 7).
          </Row>
          <Row term="Filing briefs to your Drive">
            Only if you connect one: a Google refresh token, the address of the Google account you
            connected, and the name and id of the single folder we write to. We do not read your
            Drive. Basis: art. 6(1)(a), your consent.
          </Row>
          <Row term="Keeping the service secure and working">
            Server logs kept by our hosting provider, which include IP addresses and request times.
            Basis: art. 6(1)(f), our legitimate interest in operating the service and preventing
            abuse.
          </Row>
        </div>
        <p>
          We do not process special categories of data (art. 9 GDPR), and the service is not directed
          at children under 16.
        </p>
      </Clause>

      <Clause n="3" title="What we do not do">
        <Bullets
          items={[
            'We do not sell or rent personal data, to anyone, for any purpose.',
            'We run no advertising and no advertising trackers.',
            'We run no analytics or audience-measurement tools — there is no Google Analytics, no pixel, no session recorder.',
            'We make no automated decisions producing legal or similarly significant effects, and we do not profile you (art. 22 GDPR).',
            'We do not read the contents of any cloud drive you connect. The connection is write-only, to one folder you choose.',
          ]}
        />
      </Clause>

      <Clause n="4" title="Who else processes your data">
        <p>
          The service runs on infrastructure operated by others. Each is a processor
          (<em>podmiot przetwarzający</em>) acting on our instructions under a data processing
          agreement, and each receives only what its job requires.
        </p>
        <div className="mt-4">
          <Row term="Railway">Hosting for the application and its database. Receives everything stored by the service.</Row>
          <Row term="GitHub Pages">Serves the website itself. Receives your IP address as part of any ordinary web request.</Row>
          <Row term="Resend">Sends sign-in links and email briefs. Receives your email address, your name if you gave one, and the content of the brief.</Row>
          <Row term="Google">
            Only if you use it: sign-in (your email address) and, separately, filing briefs to your
            Drive (the brief itself, into the folder you chose).
          </Row>
          <Row term="Anthropic and Firecrawl">
            Read and interpret the public listing pages of the venues in the catalogue. They receive
            venue web pages, never your personal data.
          </Row>
        </div>
        <p>
          Beyond these, we disclose personal data only where a court, a prosecutor or another public
          authority requires it under Polish or EU law.
        </p>
      </Clause>

      <Clause n="5" title="Transfers outside the EEA">
        <p>
          Some of the providers in section 4 are established in the United States. Where data is
          transferred there, the transfer relies on the European Commission&rsquo;s adequacy decision
          of 10 July 2023 for the EU–US Data Privacy Framework where the provider is certified under
          it, and otherwise on Standard Contractual Clauses adopted by the Commission under
          art. 46(2)(c) GDPR. Write to{' '}
          <a href={`mailto:${OPERATOR.email}`} className="underline hover:text-accent">
            {OPERATOR.email}
          </a>{' '}
          for a copy of the safeguards applying to a particular transfer.
        </p>
      </Clause>

      <Clause n="6" title="How long we keep it">
        <Bullets
          items={[
            <>Sign-in tokens: 15 minutes, and they are destroyed once used.</>,
            <>Sessions: until they expire or you log out, whichever comes first.</>,
            <>Your account, lists and brief settings: until you delete your account. Ask at {OPERATOR.email} and we will delete it.</>,
            <>A connected Drive: until you disconnect it, which revokes the token we hold.</>,
            <>The pre-sign-in device identifier: it lives in your browser and is gone when you clear the site&rsquo;s data.</>,
            <>Server logs: for as long as our hosting provider retains them, which is a matter of weeks rather than years.</>,
          ]}
        />
      </Clause>

      <Clause n="7" title="Your rights">
        <p>Under the GDPR you have the right to:</p>
        <Bullets
          items={[
            'access your data and obtain a copy of it (art. 15);',
            'have inaccurate data corrected (art. 16);',
            'have your data erased (art. 17);',
            'have processing restricted (art. 18);',
            'receive your data in a portable, machine-readable form (art. 20);',
            'object to processing carried out on the basis of our legitimate interest (art. 21);',
            'withdraw any consent you have given, at any time, without affecting the lawfulness of processing carried out before you withdrew it (art. 7(3)).',
          ]}
        />
        <p>
          Two of these need no email at all: the brief carries an unsubscribe link in every message,
          and a connected Drive can be disconnected from the Newsletter tab. For the rest, write to{' '}
          <a href={`mailto:${OPERATOR.email}`} className="underline hover:text-accent">
            {OPERATOR.email}
          </a>
          . We answer within one month of receiving a request, as art. 12(3) GDPR requires.
        </p>
        <p>
          You also have the right to lodge a complaint with the supervisory authority. In Poland that
          is the <strong className="text-ink">{DPA.name}</strong>, {DPA.address} —{' '}
          <a href={DPA.url} target="_blank" rel="noreferrer" className="underline hover:text-accent">
            uodo.gov.pl
          </a>
          .
        </p>
      </Clause>

      <Clause n="8" title="Cookies and browser storage">
        <p>
          {OPERATOR.service} uses no advertising or analytics cookies, and shows no cookie banner
          because it has nothing to ask you to consent to. What it does store on your device is
          strictly necessary to provide the service you requested, which art. 173(3) of the Polish
          Prawo telekomunikacyjne exempts from the consent requirement:
        </p>
        <Bullets
          items={[
            <>a session token in local storage, so you stay signed in;</>,
            <>a random device identifier in local storage, so a list survives a page reload before you have an account;</>,
            <>while the site is invitation-only, a cookie recording that a valid invitation code was entered.</>,
          ]}
        />
        <p>
          Clearing this site&rsquo;s data in your browser removes all three. Doing so signs you out
          and detaches any list you built without an account.
        </p>
      </Clause>

      <Clause n="9" title="Links to venues">
        <p>
          Listings link to the venues&rsquo; own websites and ticketing systems. Once you follow such
          a link you are on someone else&rsquo;s site, under their privacy policy, and this one no
          longer applies.
        </p>
      </Clause>

      <Clause n="10" title="Changes to this policy">
        <p>
          If this policy changes, the date at the top of the page changes with it. Where a change
          materially affects how your data is processed, we will tell you by email before it takes
          effect. The <Link to="/terms" className="underline hover:text-accent">terms of use</Link>{' '}
          govern the service itself.
        </p>
      </Clause>
    </LegalPage>
  );
}

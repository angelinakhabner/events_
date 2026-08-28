import { Link } from 'react-router-dom';
import { Bullets, Clause, LegalPage } from '../components/LegalPage';
import { LEGAL_DETAILS_COMPLETE, LEGAL_UPDATED, OPERATOR } from '../lib/legal';

/**
 * /terms — the regulamin (GOI-95).
 *
 * Polish law is specific about this document. Art. 8(1)(1) of the ustawa o
 * świadczeniu usług drogą elektroniczną obliges anyone providing a service by
 * electronic means to publish terms, free of charge, in a form the user can
 * obtain, reproduce and store — and art. 8(3) fixes what they must cover: the
 * services offered, the technical requirements, the prohibition on supplying
 * unlawful content, and the complaints procedure. Each has a clause here.
 *
 * The consumer clauses are not decoration either. AFISZ is free, but a free
 * digital service supplied in exchange for personal data is still within the
 * ustawa o prawach konsumenta as amended in 2023, which is why sections 9 and
 * 10 exist and why the fourteen-day withdrawal right is stated rather than
 * disclaimed.
 */
export function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      updated={LEGAL_UPDATED}
      intro={`The rules for using ${OPERATOR.service} — what the service is, what it is not, and what to do when it goes wrong. This document is the regulamin required by art. 8 of the Polish Act on Providing Services by Electronic Means.`}
    >
      <Clause n="1" title="Who provides the service">
        <p>
          {OPERATOR.service} is provided by{' '}
          {LEGAL_DETAILS_COMPLETE ? (
            <>
              <strong className="text-ink">{OPERATOR.entity}</strong>, {OPERATOR.address}
            </>
          ) : (
            <strong className="text-ink">the operator of {OPERATOR.service}</strong>
          )}{' '}
          (the “Provider”), contactable at{' '}
          <a href={`mailto:${OPERATOR.email}`} className="underline hover:text-accent">
            {OPERATOR.email}
          </a>
          .
        </p>
        <p>
          These terms are made available free of charge before you use the service, in a form you can
          display, copy and store, as art. 8(1)(1) of the ustawa o świadczeniu usług drogą
          elektroniczną requires.
        </p>
      </Clause>

      <Clause n="2" title="What the service does">
        <p>
          {OPERATOR.service} collects publicly published programme information from cultural venues —
          cinemas, theatres, museums, galleries, concert halls and comedy clubs — and presents it as
          one listing. Free of charge, it lets you:
        </p>
        <Bullets
          items={[
            'browse and filter what is on, without an account;',
            'create an account, choose which venues you follow, and organise them into folders;',
            'keep a “want to go” list and share it by link;',
            'add an event to your calendar;',
            'subscribe to an email brief of what is on at your venues;',
            'optionally connect a Google Drive folder, so each brief is filed there as a PDF.',
          ]}
        />
        <p>
          There is no charge for any of it, and there is nothing to buy. {OPERATOR.service} does not
          sell tickets, take bookings, or act as an intermediary between you and any venue.
        </p>
      </Clause>

      <Clause n="3" title="What you need to use it">
        <p>
          A device with internet access and a current version of a standard web browser
          (Chrome, Firefox, Safari or Edge) with JavaScript and local storage enabled. An email
          address is needed for an account or a brief, and nothing else is.
        </p>
        <p>
          Using the internet carries the ordinary risks of doing so — interception in transit,
          malware, phishing messages claiming to come from this or any other service. We send
          sign-in links from a verified domain and will never ask you for a password, because the
          service has none.
        </p>
      </Clause>

      <Clause n="4" title="Your account">
        <p>
          You sign in with a single-use link sent to your email address, or with a Google account.
          The service holds no password. Anyone with access to your mailbox can therefore sign in as
          you: keep it secure, and tell us at{' '}
          <a href={`mailto:${OPERATOR.email}`} className="underline hover:text-accent">
            {OPERATOR.email}
          </a>{' '}
          if you believe your account has been used by someone else.
        </p>
        <p>
          You may close your account at any time, for any reason, by writing to that address. Closing
          it deletes your lists, your brief and any Drive connection.
        </p>
      </Clause>

      <Clause n="5" title="The email brief">
        <p>
          The brief is sent only if you ask for it, which under art. 10 of the ustawa o świadczeniu
          usług drogą elektroniczną and art. 398 of the Prawo komunikacji elektronicznej is your
          consent to receive commercial information by electronic means. You can withdraw that
          consent at any time — from the unsubscribe link in every message, or by switching the brief
          off in your account — and it takes effect immediately.
        </p>
        <p>
          The brief reports what the venues have published. It is not an invitation to buy, and it
          carries no advertising.
        </p>
      </Clause>

      <Clause n="6" title="How you may use it">
        <p>
          Use the service lawfully and in a way that does not degrade it for others. You must not
          supply unlawful content — a prohibition art. 8(3)(2)(b) of the ustawa o świadczeniu usług
          drogą elektroniczną requires these terms to state — and in particular you must not:
        </p>
        <Bullets
          items={[
            'submit content that is unlawful, infringes anyone’s rights, or is designed to mislead;',
            'give a venue a name or tag that is defamatory, or that impersonates a real organisation;',
            'attempt to gain access to another user’s account or to parts of the service not made available to you;',
            'scrape, overload or otherwise interfere with the service, or work around its technical limits;',
            'use the service to send unsolicited commercial messages.',
          ]}
        />
        <p>
          Where content you supply is unlawful, we may remove it and suspend the account responsible,
          in accordance with art. 14 of that Act and the Digital Services Act.
        </p>
      </Clause>

      <Clause n="7" title="Accuracy of listings">
        <p>
          The listings are read from venues&rsquo; own websites, automatically. Programmes change,
          screenings are cancelled, and a page can be misread. {OPERATOR.service} therefore presents
          this information for orientation, not as a guarantee, and the venue&rsquo;s own site is
          always the authority. <strong className="text-ink">Check with the venue before you set
          out.</strong> Every listing links to its source for exactly that reason.
        </p>
        <p>
          A wrong or missing listing is worth reporting to{' '}
          <a href={`mailto:${OPERATOR.email}`} className="underline hover:text-accent">
            {OPERATOR.email}
          </a>
          .
        </p>
      </Clause>

      <Clause n="8" title="Rights in the content">
        <p>
          The design, the code and the wording of the service belong to the Provider. Programme
          information, titles, descriptions and images belong to the venues and to the rights holders
          in the works described, and appear here for the purpose of informing you what is on.
        </p>
        <p>
          Anything you enter — a folder name, a tag, your own name for a venue — stays yours. You
          grant the Provider only the permission needed to store it and show it back to you, and to
          anyone you deliberately share a list with.
        </p>
      </Clause>

      <Clause n="9" title="Complaints">
        <p>
          Complaints about the service go to{' '}
          <a href={`mailto:${OPERATOR.email}`} className="underline hover:text-accent">
            {OPERATOR.email}
          </a>
          . Please describe the problem, when it happened, and the address you use with the service.
        </p>
        <p>
          We answer within 14 days of receiving the complaint. If we do not answer within that
          period, the complaint is taken to have been accepted as submitted.
        </p>
      </Clause>

      <Clause n="10" title="If you are a consumer">
        <p>
          The service is free, but it is supplied to you as a digital service and Polish consumer law
          applies to it. You may withdraw from the contract within 14 days of creating your account,
          without giving a reason and at no cost, by writing to{' '}
          <a href={`mailto:${OPERATOR.email}`} className="underline hover:text-accent">
            {OPERATOR.email}
          </a>
          . In practice, closing your account under section 4 does the same thing at any time.
        </p>
        <p>
          Nothing in these terms limits any right you have under the ustawa o prawach konsumenta or
          the Kodeks cywilny. If a clause here conflicts with those rights, the law prevails and the
          clause does not apply to you.
        </p>
        <p>
          You may use out-of-court dispute resolution, including the consumer ombudsman
          (<em>miejski lub powiatowy rzecznik konsumentów</em>) and the Inspekcja Handlowa. Neither
          we nor you are obliged to use them.
        </p>
      </Clause>

      <Clause n="11" title="Liability and availability">
        <p>
          The Provider is liable for damage caused by failing to perform or improperly performing
          these terms, on the general principles of the Kodeks cywilny. Liability is not excluded or
          limited for wilful misconduct, nor for harm to life or health, nor — where you are a
          consumer — in any way the law forbids.
        </p>
        <p>
          The service is offered as it stands, without a guaranteed level of availability. It may be
          interrupted for maintenance, and it may be discontinued. If it is discontinued, we will
          give account holders reasonable notice by email so that anything worth keeping can be
          exported first.
        </p>
      </Clause>

      <Clause n="12" title="Changes to these terms">
        <p>
          These terms may change — for instance when a feature is added, or when the law changes.
          Account holders will be told by email at least 14 days before a change takes effect, and
          may close their account before then if they do not accept it. Continuing to use the service
          after the change means accepting it. The date at the top of this page always reflects the
          version in force.
        </p>
      </Clause>

      <Clause n="13" title="Governing law">
        <p>
          These terms are governed by Polish law. If you are a consumer resident elsewhere in the
          EU, this does not deprive you of the protection of the mandatory rules of your own
          country&rsquo;s law. Disputes are heard by the courts having jurisdiction under the Kodeks
          postępowania cywilnego.
        </p>
        <p>
          How your personal data is handled is set out in the{' '}
          <Link to="/policy" className="underline hover:text-accent">privacy policy</Link>.
        </p>
      </Clause>
    </LegalPage>
  );
}

import { LegalPage } from '../components/LegalPage';
import { NAME, TERMS_HEADING, TERMS_SECTIONS, TERMS_UPDATED } from '../landing/content';

/**
 * /terms — the regulamin (GOI-95).
 *
 * Written against the ustawa o świadczeniu usług drogą elektroniczną; the
 * clause-by-clause reasoning is in `landing/content.ts`, beside the text it
 * explains, since that is where the text lives.
 */
export function TermsPage() {
  return (
    <LegalPage
      title={TERMS_HEADING}
      updated={TERMS_UPDATED}
      sections={TERMS_SECTIONS}
      seeAlso={{ to: '/policy', label: 'privacy policy' }}
      intro={`The rules for using ${NAME} — what the service is, what it is not, and what to do when it goes wrong. This is the regulamin required by art. 8 of the Polish Act on Providing Services by Electronic Means.`}
    />
  );
}

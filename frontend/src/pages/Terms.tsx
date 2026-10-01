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
      seeAlso={{ to: '/policy', label: 'polityka prywatności' }}
      intro={`Zasady korzystania z ${NAME} — czym jest usługa, czym nie jest i co zrobić, gdy coś pójdzie nie tak. To regulamin wymagany przez art. 8 ustawy o świadczeniu usług drogą elektroniczną.`}
    />
  );
}

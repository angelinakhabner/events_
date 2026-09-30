import { LegalPage } from '../components/LegalPage';
import { NAME, POLICY_HEADING, POLICY_SECTIONS, POLICY_UPDATED } from '../landing/content';

/**
 * /policy — the privacy notice (GOI-95), for a reader who is already in the
 * app and reached it from the footer.
 *
 * The same text the public landing page carries as static HTML, from the same
 * module, so the two cannot say different things. See `LegalPage` for why that
 * matters more than it might appear to.
 */
export function PolicyPage() {
  return (
    <LegalPage
      title={POLICY_HEADING}
      updated={POLICY_UPDATED}
      sections={POLICY_SECTIONS}
      seeAlso={{ to: '/terms', label: 'regulamin' }}
      intro={`Jak ${NAME} przetwarza Twoje dane osobowe zgodnie z RODO i polskim prawem. W skrócie: adres e-mail do logowania, to, co sam(a) zapiszesz, i nic, co byłoby sprzedawane, profilowane albo wykorzystywane do reklam.`}
    />
  );
}

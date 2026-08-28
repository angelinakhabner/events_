/**
 * Who operates AFISZ, for the legal pages (GOI-95).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BEFORE THE SITE OPENS TO THE PUBLIC, FILL IN `entity` AND `address`.
 *
 * Polish law names these specifically, and a policy without them is not merely
 * thin — it is non-compliant. Art. 13(1)(a) RODO requires the controller's
 * identity and contact details in the privacy notice, and art. 8(1)(1) of the
 * ustawa o świadczeniu usług drogą elektroniczną requires the service
 * provider's identifying details in the regulamin. Both pages read from here,
 * so this is the only place either has to change.
 *
 * `LEGAL_DETAILS_COMPLETE` is what the pages check before printing the
 * placeholder line; it is deliberately derived rather than hand-set, so
 * filling the fields in is all that is needed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const OPERATOR = {
  /** Registered name of the natural person or company operating the service.
   *  e.g. "Jan Kowalski, sole trader, NIP 000-000-00-00". */
  entity: '',
  /** Registered address for correspondence. */
  address: '',
  /** Contact address for privacy requests and complaints alike. Verified in
   *  Resend and already used for sign-in mail, so it is an address that works. */
  email: 'hello@goin.app',
  /** The service as it is named to users. */
  service: 'AFISZ',
} as const;

export const LEGAL_DETAILS_COMPLETE =
  OPERATOR.entity.trim().length > 0 && OPERATOR.address.trim().length > 0;

/** When each document was last substantively changed (ISO date). Bump on any
 *  change of substance — the date is what tells a reader whether the text
 *  they are looking at covers what happened to them. */
export const LEGAL_UPDATED = '2026-08-28';

/** Poland's data-protection authority, named in art. 13(2)(d) RODO. */
export const DPA = {
  name: 'Prezes Urzędu Ochrony Danych Osobowych',
  address: 'ul. Stawki 2, 00-193 Warszawa',
  url: 'https://uodo.gov.pl',
} as const;

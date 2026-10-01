import { z, ZodIssueCode, type ZodErrorMap } from 'zod';

/**
 * The API's messages, in the language the site speaks (Polish).
 *
 * Two kinds of text reach a reader from here, and they are translated in the
 * two places each one is formed:
 *
 * - **Validation.** An input that fails its schema comes back as a list of
 *   Zod issues, and the settings screens print each issue's message beside the
 *   field it names. Zod writes its own defaults ("Required", "Invalid email")
 *   in English, so `polishErrorMap` replaces them for every schema in the
 *   process. Messages a schema states itself (a refinement's own sentence) are
 *   written in Polish where they are declared.
 *
 * - **Everything else.** The stores throw plain `Error`s whose text is also
 *   what `mapStoreError` reads to pick a status code ("not found" → 404,
 *   "already have" → 409). Rewriting those sentences at the source would
 *   quietly break that mapping, so they stay as they are and are translated
 *   once, on the way out, by `polishMessage` in the error formatter. A message
 *   with no entry here passes through unchanged: an untranslated sentence is
 *   better than a wrong one.
 */

const EXACT: Record<string, string> = {
  'Login required': 'Musisz się zalogować.',
  'Login or x-device-id required': 'Musisz się zalogować.',
  'Missing x-device-id header': 'Brak identyfikatora urządzenia.',
  'Forbidden': 'Brak dostępu.',
  'List not found': 'Nie znaleziono listy.',
  'A folder name is required': 'Podaj nazwę folderu.',
  'Venue not found in your list': 'Tego miejsca nie ma na Twojej liście.',
  'Venue not found': 'Nie znaleziono miejsca.',
  'Nothing to update': 'Nie ma nic do zmiany.',
  'Folder not found or forbidden': 'Nie znaleziono folderu.',
  'Could not resolve a list for this venue': 'Nie udało się ustalić listy dla tego miejsca.',
  'No drive is connected.': 'Nie połączono żadnego dysku.',
  'DATABASE_URL not configured': 'Baza danych nie jest skonfigurowana w tej instalacji.',
};

const PATTERNS: Array<[RegExp, (...groups: string[]) => string]> = [
  [/^You already have a list named "(.*)"$/, (name) => `Masz już listę o nazwie „${name}”.`],
  [/^You already have "(.*)" in your films$/, (title) => `„${title}” jest już na Twojej liście filmów.`],
  [/^Could not resolve a folder named "(.*)"$/, (name) => `Nie udało się znaleźć folderu „${name}”.`],
  [/^Film .* not found$/, () => 'Nie znaleziono filmu.'],
  [/^Folder .* not found$/, () => 'Nie znaleziono folderu.'],
];

/** A store's English error message, as the reader should see it. */
export function polishMessage(message: string): string {
  const exact = EXACT[message];
  if (exact) return exact;
  for (const [pattern, render] of PATTERNS) {
    const m = pattern.exec(message);
    if (m) return render(...m.slice(1));
  }
  return message;
}

/**
 * Zod's default messages in Polish. Only the codes a form in this app can
 * actually produce are spelled out; anything rarer falls back to Zod's own
 * wording rather than to a guess.
 */
export const polishErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return { message: 'To pole jest wymagane.' };
      return { message: 'Nieprawidłowy typ wartości.' };
    case ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Nieprawidłowy adres e-mail.' };
      if (issue.validation === 'uuid') return { message: 'Nieprawidłowy identyfikator.' };
      if (issue.validation === 'url') return { message: 'Nieprawidłowy adres URL.' };
      return { message: 'Nieprawidłowy tekst.' };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return { message: issue.minimum === 1 ? 'To pole nie może być puste.' : `Wpisz co najmniej ${issue.minimum} znaki.` };
      }
      if (issue.type === 'number') return { message: `Wartość musi wynosić co najmniej ${issue.minimum}.` };
      if (issue.type === 'array') return { message: `Wybierz co najmniej ${issue.minimum}.` };
      break;
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Maksymalnie ${issue.maximum} znaków.` };
      if (issue.type === 'number') return { message: `Wartość może wynosić najwyżej ${issue.maximum}.` };
      if (issue.type === 'array') return { message: `Wybierz najwyżej ${issue.maximum}.` };
      break;
    case ZodIssueCode.invalid_enum_value:
      return { message: 'Nieprawidłowa wartość.' };
    default:
      break;
  }
  return { message: ctx.defaultError };
};

z.setErrorMap(polishErrorMap);

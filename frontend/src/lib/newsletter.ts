import type {
  NewsletterCategoryRule, NewsletterDelivery, NewsletterGrouping, NewsletterSendCadence, NewsletterWantToGo,
} from '@afisz/shared';
import { DEFAULT_WANT_TO_GO } from '@afisz/shared';
import { pad } from './format';

/**
 * What the newsletter can do, in one paragraph (GOI-97).
 *
 * The tab's standing description used to be an example of somebody's brief —
 * "Get what's on at Kino Muranów, Muzeum Sztuki Nowoczesnej and 6 more as an
 * email brief — every day at 08:00, everything after 18:00." Two venues by
 * name and one fixed timetable, printed above a form that can do far more
 * than that, is a poor advertisement for the feature and a poor instruction
 * for the reader: it reads as the only shape a brief comes in.
 *
 * So the heading describes the *capability* — the four decisions the form
 * below actually offers — and names no venue and no hour. What the reader has
 * set up is a different sentence with a different job, and it is still printed
 * (see `briefSummary`), live, right under this one.
 */
export const NEWSLETTER_BLURB =
  'Przegląd tego, co nadchodzi w obserwowanych przez Ciebie miejscach, ułożony tak, jak chcesz go czytać. ' +
  'Wybierz, kiedy przychodzi — codziennie, raz w tygodniu albo raz w miesiącu — i nadaj każdej kategorii ' +
  'własny rytm, szczegółowość i zasięg, tak by kino pojawiało się codziennie w jednej linijce, a muzea ' +
  'raz w miesiącu w pełnej wersji. Zapisane wydarzenia mogą dołączyć. Dostajesz go e-mailem, jako PDF ' +
  'zapisany na Twoim dysku albo na oba sposoby.';

/**
 * The form's state, as the request body the API expects (GOI-105).
 *
 * Pulled out of `NewsletterSection` because it could not be tested where it
 * was. It lived as a closure over fourteen `useState` values, so the only way
 * to ask "what does the form send when the cadence is monthly and the reader
 * has a weekly cinema rule?" was to render the page and drive the controls —
 * which is why nobody ever asked it for more than a handful of the
 * combinations. It is a pure function of the form state now, and
 * `newsletter-payload.test.ts` walks every combination through the server's
 * own schema.
 *
 * The nulling here mirrors the schema's rule 2 rather than duplicating a
 * decision: a weekday means nothing to a daily brief, and sending one anyway
 * would store a value that does nothing. The server nulls it too — this is the
 * form agreeing in advance, not the form deciding.
 */
export interface NewsletterFormState {
  /** The newsletter being edited (GOI-126); absent for one not saved yet. */
  id?: string;
  email: string;
  recipientName: string;
  delivery: NewsletterDelivery;
  name?: string;
  sendCadence: NewsletterSendCadence;
  sendHour: number;
  sendMinute: number;
  sendWeekday: number;
  sendDayOfMonth: number;
  venueIds: string[];
  /** One entry per title, or a block per venue (GOI-141). */
  groupBy?: NewsletterGrouping;
  /** The reader's venue order, by id (GOI-140). */
  venueOrder?: string[];
  rules: NewsletterCategoryRule[];
  wantToGo: NewsletterWantToGo;
  enabled: boolean;
}

export function newsletterPayload(form: NewsletterFormState) {
  return {
    // Undefined for a new newsletter, which JSON then leaves out entirely.
    id: form.id,
    email: form.email.trim(),
    recipientName: form.recipientName.trim() || null,
    delivery: form.delivery,
    folderId: null,
    name: form.name ?? 'Newsletter',
    sendCadence: form.sendCadence,
    sendHour: form.sendHour,
    sendMinute: form.sendMinute,
    sendWeekday: form.sendCadence === 'weekly' ? form.sendWeekday : null,
    sendDayOfMonth: form.sendCadence === 'monthly' ? form.sendDayOfMonth : null,
    venueIds: form.venueIds,
    groupBy: form.groupBy ?? 'event',
    venueOrder: form.venueOrder ?? [],
    categoryRules: form.rules,
    wantToGo: form.wantToGo,
    enabled: form.enabled,
  };
}

/**
 * Every field name this build's request body can legitimately contain
 * (GOI-105).
 *
 * Derived from `newsletterPayload` itself, so it cannot drift from what the
 * form actually sends, and *statically* — from a canonical rule rather than
 * from whatever the form is holding right now. That distinction is the whole
 * point of it.
 *
 * `readableApiError` used to read these names off the live payload, which is
 * defeated by exactly the situation it exists to detect. An API old enough to
 * reject this build is also old enough to have *served* the settings the form
 * loaded: the pre-GOI-100 `newsletter.get` returns category rules shaped
 * `{category, frequency, detail}`, the form seeds its rows from them, and
 * sends them back untouched. So the payload contains a `frequency` key —
 * echoed straight from the stale server — the check sees a field it "knows",
 * and concludes the rejection is a bad value rather than a version mismatch.
 * The reader gets two lines naming fields that are not on their screen and no
 * explanation. A static set cannot be poisoned that way.
 */
export const NEWSLETTER_FIELDS: ReadonlySet<string> = collectKeys(
  newsletterPayload({
    email: '',
    recipientName: '',
    delivery: 'email',
    sendCadence: 'weekly',
    sendHour: 0,
    sendMinute: 0,
    sendWeekday: 1,
    sendDayOfMonth: 1,
    venueIds: [],
    rules: [{
      category: '',
      cadence: 'every_issue',
      cadenceWeekday: null,
      detail: 'short',
      timeFilter: 'any',
      lookaheadDays: null,
      sortOrder: 0,
    }],
    wantToGo: DEFAULT_WANT_TO_GO,
    enabled: true,
  }),
);

/** Every key anywhere in a value, so a nested field counts too. */
function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
    return into;
  }
  if (typeof value !== 'object' || value === null) return into;
  for (const [key, child] of Object.entries(value)) {
    into.add(key);
    collectKeys(child, into);
  }
  return into;
}

/** Weekday names, JS convention (0=Sun … 6=Sat). */
/** "Every <weekday>", JS convention (0=Sun). Whole phrases rather than names,
 *  because Polish agrees "każdy" / "każdą" with the day's gender. */
const EVERY_WEEKDAY = [
  'w każdą niedzielę', 'w każdy poniedziałek', 'w każdy wtorek', 'w każdą środę',
  'w każdy czwartek', 'w każdy piątek', 'w każdą sobotę',
];

export interface BriefSummaryInput {
  /** Names of the venues the brief covers; empty means "all of them". */
  venueNames: string[];
  frequency: 'daily' | 'weekly' | 'monthly';
  sendHour: number;
  sendMinute: number;
  /** JS weekday, only meaningful for a weekly brief. */
  sendWeekday: number;
  /** "Only events after this hour", or null for no cutoff. */
  afterHour: number | null;
  /** Where it is sent. Blank until the reader types one. */
  email?: string;
  /** Email, a filed PDF, or both. Decides how the line names its destination
   *  — "emailed to ania@example.com" is a lie to a drive-only reader. */
  delivery?: NewsletterDelivery;
  /** A saved-but-switched-off brief sends nothing; the line has to say so. */
  enabled?: boolean;
}

/**
 * One sentence describing the brief the reader has actually set up (GOI-30),
 * covering all four of the things it decides (GOI-97).
 *
 * This line used to be a fixed example — "e.g. Kino Muranów and Kinoteka,
 * every day at 08:00, everything after 6 pm" — printed directly above controls
 * that said something else. Two statements of the same fact, one of them
 * fiction, is worse than one: a reader with the brief set to 15:00 read "every
 * day at 08:00" and had no way to tell which was true. So it is derived from
 * the live form state instead, and follows every edit.
 *
 * What it long stopped short of saying is what you would actually receive. It
 * named the venues and the send time and left the two questions people ask
 * first unanswered: *how much* is in it, and *where does it go*. The window is
 * the real content of the setting — "every day" and "once a month" are not two
 * rhythms of the same email, they are 24 hours of listings versus 30 days of
 * them — and the address is the one field a typo makes silently useless. Both
 * are stated outright now, along with the cutoff and, when the brief is
 * switched off, the fact that nothing is being sent at all.
 *
 * It names three venues at most — the point is to recognise your own setup at
 * a glance, and a list of fourteen is not read, it's skipped.
 */
export function briefSummary(input: BriefSummaryInput): string {
  const where = venuePhrase(input.venueNames);
  const when = `${cadence(input)} o ${pad(input.sendHour)}:${pad(input.sendMinute)}`;
  const only = input.afterHour == null ? '' : ` — tylko to, co zaczyna się po ${pad(input.afterHour)}:00`;
  // The venues follow a dash rather than a preposition: "z" would have to
  // decline every venue name, and a venue's name is not ours to decline.
  const line =
    `${horizon(input.frequency)} — ${where}, ${destination(input)} ${when}${only}.`;
  // Capitalised by the horizon phrase, which always leads.
  return input.enabled === false ? `${line} Wstrzymany — nic nie jest wysyłane.` : line;
}

/**
 * How much of the calendar the brief reaches, in the words the sweep means by
 * it: `briefWindowDays` on the backend turns the cadence into 1, 7 or 30 days
 * of upcoming events, so the line says days rather than repeating the cadence.
 */
function horizon(frequency: BriefSummaryInput['frequency']): string {
  if (frequency === 'daily') return 'Najbliższe 24 godziny';
  if (frequency === 'weekly') return 'Najbliższe 7 dni';
  return 'Najbliższe 30 dni';
}

/**
 * Where the brief actually goes.
 *
 * The line named an address unconditionally, which was right while email was
 * the only delivery there was and false the moment a reader could choose to
 * have it filed instead. The same reasoning as GOI-30: two statements of one
 * fact, with one of them fiction, is worse than one statement.
 */
function destination(input: BriefSummaryInput): string {
  const delivery = input.delivery ?? 'email';
  if (delivery === 'drive') return 'zapisywane na Twoim dysku jako PDF';
  const to = `wysyłane na ${recipient(input.email)}`;
  return delivery === 'both' ? `${to} i zapisywane na Twoim dysku` : to;
}

/** The address, or a placeholder while the field is still empty. */
function recipient(email: string | undefined): string {
  const trimmed = email?.trim();
  return trimmed ? trimmed : 'Twoją skrzynkę';
}

function venuePhrase(names: string[]): string {
  if (names.length === 0) return 'wszystkie Twoje miejsca';
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} i ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} i ${names[2]}`;
  return `${names[0]}, ${names[1]} i jeszcze ${names.length - 2}`;
}

function cadence({ frequency, sendWeekday }: BriefSummaryInput): string {
  if (frequency === 'daily') return 'codziennie';
  if (frequency === 'monthly') return 'raz w miesiącu';
  return EVERY_WEEKDAY[sendWeekday] ?? EVERY_WEEKDAY[1]!;
}

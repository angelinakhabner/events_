import type { Festival } from '@afisz/shared';

/**
 * The brief's Polish vocabulary and the dates that go with it (GOI-110).
 *
 * Extracted from `newsletter-pdf.ts`, which had it to itself while the PDF was
 * the only surface drawn to the design. The email is drawn to the same design
 * now, and two copies of Polish plural rules and a Roman-numeral month table
 * would drift the first time either was edited — a brief whose PDF and email
 * disagree about a date is worse than one that is wrong in both.
 */

const TZ = 'Europe/Warsaw';

/**
 * The brief's own words, in Polish.
 *
 * The rest of the interface is English on purpose — the wordmark and the home
 * page's headline are the brand and the chrome around them stays in English
 * (see `Hero` in `pages/Home.tsx`). The brief is the one surface that breaks
 * that, and deliberately: everything *in* it is already Polish — the titles,
 * the venues, the descriptions the venues wrote — so English section headings
 * over Polish content read as a translation layer nobody asked for.
 *
 * Collected here rather than inlined so the decision is one edit to revisit,
 * and so a reader of this file can see the whole vocabulary at once.
 */
export const PL = {
  wordmark: 'AFISZ.KA',
  city: 'WARSZAWA',
  wantToGo: 'Want to go',
  changes: 'Zmiany',
  lastChance: 'Ostatnia szansa',
  tomorrow: 'Jutro',
  thisWeek: 'W tym tygodniu',
  /** Not "w tym tygodniu": the band carries festivals that open later than
   *  this week too (GOI-110), and each row prints its own dates. */
  festivals: 'Festiwale',
  nothing: 'W tym tygodniu nic nie znaleźliśmy w Twoich miejscach.',
  settings: 'Zmień ustawienia',
  unsubscribe: 'Wypisz się',
  open: 'Otwórz w AFISZ.KA',
  /** Who the brief is from, under the footer links — a commercial email has
   *  to name its sender, and the design prints it there. */
  sender: 'AFISZ.KA · ul. Przykładowa 12, 00-001 Warszawa',
  /** `n` events from `m` of your venues. Polish counts in three forms. */
  summary: (events: number, venues: number) =>
    `${events} ${plural(events, 'wydarzenie', 'wydarzenia', 'wydarzeń')} ` +
    `z Twoich ${venues} ${plural(venues, 'miejsca', 'miejsc', 'miejsc')}.`,
  /**
   * The reader's name, ahead of the count.
   *
   * A dash rather than a greeting, and that is a language decision, not a
   * terse one: Polish addresses someone in the vocative — "Angelina" becomes
   * "Angelino" — and there is no reliable way to decline an arbitrary name,
   * including names that are not Polish at all. A greeting that gets the case
   * wrong is more jarring than no greeting, so the name is simply named.
   */
  addressed: (name: string, rest: string) => `${name} — ${rest}`,
  /** What a change says, beside the title. */
  rescheduled: (at: string) => `seans przeniesiony na ${at}`,
  cancelled: 'odwołane',
  movedVenue: 'zmiana miejsca',
  soldOut: 'brak biletów',
  until: (date: string) => `do ${date}`,
  /** The two halves a museums section splits into (GOI-122): a run you can
   *  drop in on any day, and something happening at a time. */
  exhibitions: 'Wystawy',
  events: 'Wydarzenia',
  /** An open-ended run — one with no announced closing date. */
  from: (date: string) => `od ${date}`,
  /**
   * The built-in categories, in the brief's own language (GOI-110).
   *
   * Only the built-ins: a reader's own venue tag is their word for the thing
   * and is printed as they typed it, since translating someone's "arthouse"
   * would be inventing a name for something they already named.
   */
  categories: {
    cinema: 'Kino',
    theatre: 'Teatr i muzyka',
    music: 'Teatr i muzyka',
    comedy: 'Kabaret',
    exhibition: 'Wystawy',
  },
} as const;

/**
 * Polish plurals: one form for 1, another for 2–4, a third for everything else
 * — with the teens taking the third whatever their last digit says. Getting
 * this wrong is the sort of thing that makes generated copy read as generated.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const last = n % 10;
  const lastTwo = n % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

/** Months as Polish convention writes them in a short date: `11 VIII`. */
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];


export function fmt(iso: string, opts: Intl.DateTimeFormatOptions, locale = 'pl-PL'): string {
  return new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts }).format(new Date(iso));
}

/** `19:00` on the Warsaw clock. */
export function time(iso: string): string {
  return fmt(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** `PT`, `ŚR` — the day, for a gutter that has no time to show. */
export function weekday(iso: string): string {
  return fmt(iso, { weekday: 'short' }).replace(/\.$/, '').toUpperCase();
}

/** `WT 11 VIII` — the Polish short date, for a section spanning days. */
export function shortDate(iso: string): string {
  const day = Number(fmt(iso, { day: 'numeric' }));
  const month = Number(fmt(iso, { month: 'numeric' })) - 1;
  return `${weekday(iso)} ${day} ${ROMAN[month]}`;
}

/** `10–16 SIERPNIA` — the span the brief covers, for the masthead. */
export function dateRange(from: Date, days: number): string {
  const to = new Date(from.getTime() + Math.max(days - 1, 0) * 86_400_000);
  const fromDay = fmt(from.toISOString(), { day: 'numeric' });
  // The month comes off the *end* of the range, and in the genitive Polish
  // uses with a day number — which is what asking for day+month together
  // gets, and what asking for the month alone does not.
  const toLong = fmt(to.toISOString(), { day: 'numeric', month: 'long' });
  if (days <= 1) return toLong.toUpperCase();
  return `${fromDay}–${toLong}`.toUpperCase();
}

/**
 * `5 SIERPNIA, SOBOTA` — a date in the shape GOI-122 asks for.
 *
 * Day, month, weekday, which is the order the request writes it in ("5th Aug,
 * Saturday") rather than `shortDate`'s weekday-first "SB 5 VIII". The month is
 * spelled out and lands in the genitive Polish uses after a day number, which
 * is what asking for day and month together gets.
 */
export function longDate(iso: string): string {
  // Upper-cased here, as `shortDate` and `dateRange` are: the design sets every
  // eyebrow in caps, and a helper that returns mixed case leaves the rendered
  // markup disagreeing with the rendered page.
  return `${fmt(iso, { day: 'numeric', month: 'long' })}, ${fmt(iso, { weekday: 'long' })}`
    .toUpperCase();
}

/**
 * `5 SIERPNIA – 14 WRZEŚNIA` — the run of an exhibition, from when till when.
 *
 * The weekdays `longDate` carries are dropped here on purpose: a reader
 * planning a visit to something on for six weeks is choosing a date, not a
 * day, and two weekday names inside one line is where the row stops being
 * readable. A run with no announced closing date says only when it opened.
 */
export function runSpan(startIso: string, endIso: string | null): string {
  const day = (iso: string) => fmt(iso, { day: 'numeric', month: 'long' });
  const span = endIso ? `${day(startIso)} \u2013 ${day(endIso)}` : PL.from(day(startIso));
  return span.toUpperCase();
}

/** `DO 14 WRZEŚNIA` — an exhibition is dated by when it closes. */
export function closingDate(iso: string): string {
  return PL.until(fmt(iso, { day: 'numeric', month: 'long' })).toUpperCase();
}

/**
 * `10–16 VIII` — a festival's run, beside its name.
 *
 * The month comes off the end date and is Roman, as Polish listings write a
 * span. Both renderers print this line, so it lives here rather than being
 * assembled twice from `ROMAN` and two `fmt` calls.
 */
export function festivalSpan(f: Festival): string {
  const from = fmt(`${f.startDate}T12:00:00Z`, { day: 'numeric' });
  const to = fmt(`${f.endDate}T12:00:00Z`, { day: 'numeric' });
  return `${from}–${to} ${ROMAN[Number(f.endDate.slice(5, 7)) - 1]}`;
}

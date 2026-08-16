export type Category =
  | 'cinema'
  | 'theatre'
  | 'exhibition'
  | 'comedy'
  | 'music'
  | 'other';

export interface Venue {
  id: string;
  name: string;
  url: string;
  city: string;
  country: string;
  category: Category;
  language: string;
  timezone: string;
  createdAt: string;
}

/**
 * What sort of thing a row is (GOI-67).
 *
 * - `timed`      — a single occurrence at a clock time: a screening, a
 *                  performance, a 17:30 workshop.
 * - `exhibition` — a run over a date range with no meaningful start hour.
 *                  `startsAt` is its opening day at local midnight and
 *                  `endsAt` its closing day; neither is a showtime.
 *
 * Before this existed, an exhibition was stored as a timed event whose hour
 * happened to be midnight, and the listing printed that hour as if it meant
 * something.
 */
export type EventKind = 'timed' | 'exhibition';

export interface Event {
  id: string;
  venueId: string;
  /** Inline venue summary — populated by events.listDefault and listByVenue
   *  so the frontend doesn't need a separate venues.list join. Optional so
   *  pure unit tests and mock data can construct events without a venue. */
  venue?: EventVenue;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  /** See EventKind. Optional on the wire so older clients and the many test
   *  fixtures predating GOI-67 still typecheck; absent means `timed`, which is
   *  what the column defaults to. Read it through `eventKind`. */
  kind?: EventKind;
  category: Category;
  language: string | null;
  director: string | null;
  cast: string[];
  durationMinutes: number | null;
  /** In grosze (1/100 PLN). e.g. 2200 = 22 PLN. */
  priceMin: number | null;
  priceMax: number | null;
  sourceUrl: string;
  sourceId: string | null;
  scrapedAt: string;
}

/** An event's kind, defaulting rows that predate GOI-67 to `timed`. */
export function eventKind(event: Pick<Event, 'kind'>): EventKind {
  return event.kind === 'exhibition' ? 'exhibition' : 'timed';
}

/** True for a run over a date range rather than a single timed occurrence. */
export function isExhibition(event: Pick<Event, 'kind'>): boolean {
  return eventKind(event) === 'exhibition';
}

/** Subset of Venue carried inline on Event responses. */
export interface EventVenue {
  id: string;
  name: string;
  category: Category;
  city: string;
  country: string;
}

export interface Folder {
  id: string;
  userId: string | null;
  name: string;
  venueIds: string[];
  filters: EventFilters;
  createdAt: string;
}

export interface EventFilters {
  categories?: Category[];
  cities?: string[];
  countries?: string[];
  daysOfWeek?: number[];
  startHour?: number;
  endHour?: number;
  priceMax?: number;
}

export interface VenueListInput {
  city?: string;
  country?: string;
  category?: Category;
}

export interface ScrapeRun {
  id: string;
  venueId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'success_empty' | 'failed' | 'skipped_unchanged';
  eventsFound: number | null;
  errorMessage: string | null;
  rawHash: string | null;
  /** Detail pages fetched for descriptions, and what extracting them cost
   *  (GOI-79). Zero on every run that enriched nothing. */
  detailFetches?: number;
  detailInputTokens?: number;
  detailOutputTokens?: number;
}

// ─── Films (want to watch / seen) ────────────────────────────────────────────

export type FilmStatus = 'want' | 'seen';

export interface Film {
  id: string;
  title: string;
  status: FilmStatus;
  /** Where it was watched — free text, filled when moving to "seen". */
  watchedVenue: string | null;
  /** Short personal note, filled when moving to "seen". */
  comment: string | null;
  watchedAt: string | null;
  createdAt: string;
}

// ─── Want to go ──────────────────────────────────────────────────────────────

/** A saved event, plus when (if ever) the user marked it seen. */
export interface WantToGoEntry {
  event: Event;
  /** ISO instant the entry was marked seen; null while it's still upcoming. */
  seenAt: string | null;
  savedAt: string;
}

/**
 * Someone else's "want to go" list, opened through a share link (GOI-47).
 *
 * Read-only and unattributed: it carries what the owner wants to go to and
 * nothing about who they are. Entries already marked seen are left out — a
 * shared list is an invitation, not a diary.
 */
export interface SharedWantToGoList {
  entries: WantToGoEntry[];
  films: Film[];
}

// ─── Newsletter ──────────────────────────────────────────────────────────────

export type NewsletterFrequency = 'daily' | 'weekly' | 'monthly';

/** How much of each event a section shows: a trimmed one-liner, or the whole
 *  blurb ("wide"). */
export type NewsletterDetail = 'short' | 'full';

/**
 * One category's own place in the brief: how often it turns up, and how much
 * it says. "Cinema daily, short; museums monthly, wide."
 *
 * `category` matches either a built-in event category ("cinema") or one of the
 * reader's own venue tags ("arthouse") — whichever they picked.
 */
export interface NewsletterCategoryRule {
  category: string;
  frequency: NewsletterFrequency;
  detail: NewsletterDetail;
}

export interface NewsletterSettings {
  email: string;
  /** Name the brief greets you by; null greets you without one. */
  recipientName: string | null;
  frequency: NewsletterFrequency;
  /** Venues the brief covers; empty = all of the user's venues. */
  venueIds: string[];
  /** Only include events starting at/after this hour (0-23), e.g. 18 = after 6 pm. */
  afterHour: number | null;
  /** Only include events starting before this hour (0-23). */
  beforeHour: number | null;
  /** Warsaw hour the brief is sent at (0-23). */
  sendHour: number;
  /** Minute past `sendHour` the brief is sent at (0-59). */
  sendMinute: number;
  /** Weekday weekly briefs go out on (0=Sun … 6=Sat). Ignored when daily. */
  sendWeekday: number;
  /** Per-category cadence and detail. Empty = one brief covering everything,
   *  on the subscription's own `frequency`. */
  categoryRules: NewsletterCategoryRule[];
  enabled: boolean;
  lastSentAt: string | null;
}

// ─── Festivals ───────────────────────────────────────────────────────────────

export interface Festival {
  id: string;
  name: string;
  url: string;
  /** Cinemas (venue names) hosting the festival. */
  cinemas: string[];
  city: string;
  /** ISO dates (YYYY-MM-DD), inclusive. */
  startDate: string;
  endDate: string;
  description: string;
  status: 'ongoing' | 'upcoming';
}

// ─── Festivals at a user's venues (GOI-33) ───────────────────────────────────

/** A festival plus the reader's own venues that are hosting it. */
export interface FestivalAtVenues extends Festival {
  /** The user's venue names that host this festival, as the user names them. */
  yourVenues: string[];
}

/**
 * Fold case and strip diacritics for venue-name matching.
 *
 * The festival list is curated by hand and the venue list is scraped or typed
 * by users, so "Kino Muranów", "kino muranow" and "Muranów" all turn up for
 * the same cinema. Without folding, a festival silently matches nothing.
 */
function foldVenueName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Polish ł has no combining form, so NFD leaves it alone.
    .replace(/ł/gi, 'l')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Which of `venueNames` host `festival`.
 *
 * Matching is containment either way, because the two sources disagree on how
 * much of the name to include — a venue called "Muranów" and a festival
 * listing "Kino Muranów" are the same cinema. Containment on a folded string
 * is deliberately loose; the alternative (exact match) misses most real pairs.
 */
export function festivalVenueMatches(festival: Festival, venueNames: string[]): string[] {
  const hosts = festival.cinemas.map(foldVenueName).filter(Boolean);
  if (hosts.length === 0) return [];
  return venueNames.filter((name) => {
    const folded = foldVenueName(name);
    if (!folded) return false;
    return hosts.some((h) => h === folded || h.includes(folded) || folded.includes(h));
  });
}

/**
 * Festivals happening at venues the reader actually follows (GOI-33), each
 * annotated with which of their venues host it. Order is preserved.
 */
export function festivalsAtVenues(festivals: Festival[], venueNames: string[]): FestivalAtVenues[] {
  return festivals
    .map((f) => ({ ...f, yourVenues: festivalVenueMatches(f, venueNames) }))
    .filter((f) => f.yourVenues.length > 0);
}

// ─── Venue break / "dark until" notice (GOI-13) ──────────────────────────────

/**
 * What a venue's calendar is doing, derived from its upcoming events rather
 * than from a field someone has to remember to set.
 *
 * - `running`  — something is on within the next few days; nothing to say.
 * - `quiet`    — nothing until a known date. Theatres go dark between seasons
 *                and museums close for a re-hang; without this the venue just
 *                looks broken.
 * - `dark`     — nothing upcoming at all. Either genuinely closed, or the
 *                listing hasn't been published yet; the copy can't tell those
 *                apart and shouldn't pretend to.
 */
export type VenueScheduleState = 'running' | 'quiet' | 'dark';

export interface VenueSchedule {
  state: VenueScheduleState;
  /** ISO start of the next event, when there is one. */
  nextStartsAt: string | null;
  upcomingCount: number;
  /** Whole days from now until the next event; null when nothing is upcoming. */
  daysUntilNext: number | null;
}

/**
 * Days of empty calendar before a venue is called quiet. A week is normal
 * slack for a theatre that publishes weekly; a fortnight is a real break.
 */
export const VENUE_QUIET_AFTER_DAYS = 14;

/** Classify a venue's calendar. Pure — the caller supplies "now". */
export function venueSchedule(
  activity: { nextStartsAt: string | null; upcomingCount: number },
  now: Date = new Date(),
  quietAfterDays: number = VENUE_QUIET_AFTER_DAYS,
): VenueSchedule {
  const { nextStartsAt, upcomingCount } = activity;
  const t = nextStartsAt ? Date.parse(nextStartsAt) : NaN;
  if (!nextStartsAt || Number.isNaN(t)) {
    return { state: 'dark', nextStartsAt: null, upcomingCount, daysUntilNext: null };
  }
  // Round down: an event 13.9 days out is still "13 days", so the threshold
  // means what it says rather than tripping half a day early.
  const daysUntilNext = Math.floor((t - now.getTime()) / 86_400_000);
  return {
    state: daysUntilNext >= quietAfterDays ? 'quiet' : 'running',
    nextStartsAt,
    upcomingCount,
    daysUntilNext,
  };
}

// ─── Venue URL probe (GOI-72) ────────────────────────────────────────────────

/**
 * How a venue's events are read. The first three are free to refetch — the
 * daily cron can re-run them without a hash check or an LLM call — which is
 * why the method is stored rather than re-derived each sweep.
 */
export type SourceMethod =
  | 'jsonld'
  | 'ical'
  | 'wp_rest'
  | 'wp_rest_posts'
  | 'rss'
  | 'llm_extract'
  | 'firecrawl'
  | 'manual';

/** Free to refetch: no hash check, no model call, no vendor bill. */
export const FREE_SOURCE_METHODS: SourceMethod[] = ['jsonld', 'ical', 'wp_rest'];

export function isFreeSourceMethod(method: SourceMethod): boolean {
  return FREE_SOURCE_METHODS.includes(method);
}

/** How much the probe trusts what it found. Drives nothing automatically —
 *  it's what an operator reads when a venue starts producing nonsense. */
export type SourceConfidence = 'high' | 'medium' | 'low';

export type ProbeErrorCode =
  | 'INVALID_URL'
  | 'SOCIAL_ONLY'
  | 'UNREACHABLE'
  | 'BLOCKED'
  | 'NOT_HTML'
  | 'NO_LISTING_PAGE_FOUND'
  | 'NO_EVENTS_FOUND'
  | 'PAST_EVENTS_ONLY'
  | 'JS_RENDERED_NEEDS_PAID'
  | 'PAID_QUOTA_EXCEEDED'
  | 'PAID_FETCH_FAILED'
  | 'RATE_LIMITED'
  | 'PROBE_TIMEOUT';

/**
 * `fatal` — this URL will never work, stop.
 * `retryable` — nothing is wrong with the URL, the attempt failed.
 * `needs_decision` — we need something from *you*: a deeper link, or consent
 *   to spend a paid fetch. These must not render as breakage (GOI-72 §5).
 */
export type ProbeSeverity = 'fatal' | 'retryable' | 'needs_decision';

export const PROBE_ERROR_SEVERITY: Record<ProbeErrorCode, ProbeSeverity> = {
  INVALID_URL: 'fatal',
  SOCIAL_ONLY: 'fatal',
  UNREACHABLE: 'retryable',
  BLOCKED: 'retryable',
  NOT_HTML: 'fatal',
  NO_LISTING_PAGE_FOUND: 'needs_decision',
  NO_EVENTS_FOUND: 'needs_decision',
  PAST_EVENTS_ONLY: 'needs_decision',
  JS_RENDERED_NEEDS_PAID: 'needs_decision',
  PAID_QUOTA_EXCEEDED: 'fatal',
  PAID_FETCH_FAILED: 'retryable',
  RATE_LIMITED: 'retryable',
  PROBE_TIMEOUT: 'retryable',
};

export type ProbeLocale = 'pl' | 'en';

/**
 * User-facing text per code. No stack trace, HTTP status or Zod complaint ever
 * reaches the UI — every failure is one of these sentences.
 */
export const PROBE_MESSAGES: Record<ProbeLocale, Record<ProbeErrorCode, string>> = {
  en: {
    INVALID_URL: 'That doesn’t look like a web address. Try something like teatr-zydowski.art.pl.',
    SOCIAL_ONLY: 'This is a Facebook or Instagram page. We can only read venue websites.',
    UNREACHABLE: 'We couldn’t reach this site. It may be down — try again later.',
    BLOCKED: 'This site is blocking automated access.',
    NOT_HTML: 'This link points to a file, not a web page.',
    NO_LISTING_PAGE_FOUND: 'We found the site but no events page. Paste the direct link to their programme.',
    NO_EVENTS_FOUND: 'We read the page but found no events on it.',
    PAST_EVENTS_ONLY: 'We only found past events here.',
    JS_RENDERED_NEEDS_PAID: 'This site needs a full browser to read. We can try a paid fetch.',
    PAID_QUOTA_EXCEEDED: 'You’ve used your paid checks for today.',
    PAID_FETCH_FAILED: 'The paid fetch didn’t work on this site.',
    RATE_LIMITED: 'Too many checks. Wait a minute and try again.',
    PROBE_TIMEOUT: 'This took too long. The site may be slow.',
  },
  pl: {
    INVALID_URL: 'To nie wygląda na adres strony. Spróbuj np. teatr-zydowski.art.pl.',
    SOCIAL_ONLY: 'To strona na Facebooku lub Instagramie. Czytamy tylko strony internetowe miejsc.',
    UNREACHABLE: 'Nie udało się połączyć z tą stroną. Może być niedostępna — spróbuj później.',
    BLOCKED: 'Ta strona blokuje automatyczny dostęp.',
    NOT_HTML: 'Ten link prowadzi do pliku, a nie do strony internetowej.',
    NO_LISTING_PAGE_FOUND: 'Znaleźliśmy stronę, ale nie jej repertuar. Wklej bezpośredni link do programu.',
    NO_EVENTS_FOUND: 'Odczytaliśmy stronę, ale nie znaleźliśmy na niej wydarzeń.',
    PAST_EVENTS_ONLY: 'Znaleźliśmy tu tylko minione wydarzenia.',
    JS_RENDERED_NEEDS_PAID: 'Ta strona wymaga pełnej przeglądarki. Możemy spróbować płatnego pobrania.',
    PAID_QUOTA_EXCEEDED: 'Wykorzystałeś dzisiejszy limit płatnych sprawdzeń.',
    PAID_FETCH_FAILED: 'Płatne pobranie nie zadziałało na tej stronie.',
    RATE_LIMITED: 'Za dużo sprawdzeń. Odczekaj minutę i spróbuj ponownie.',
    PROBE_TIMEOUT: 'To trwało zbyt długo. Strona może działać wolno.',
  },
};

export function probeMessage(code: ProbeErrorCode, locale: ProbeLocale = 'en'): string {
  return PROBE_MESSAGES[locale][code];
}

/** A single event shown back to the user so they can confirm we found the
 *  right thing before committing. Title + date only, by design. */
export interface ProbeSampleEvent {
  title: string;
  /** ISO start, or null for an undated/all-day entry (the exhibition case). */
  startsAt: string | null;
}

export interface ProbeSuccess {
  status: 'success';
  /** Normalized pasted URL — the venue dedup key. */
  normalizedUrl: string;
  /** The candidate that actually yielded events; often deeper than the paste. */
  sourceUrl: string;
  method: SourceMethod;
  confidence: SourceConfidence;
  suggestedName: string | null;
  /** Page language from <html lang>, bare code. */
  language: string | null;
  sampleEvents: ProbeSampleEvent[];
  /** This URL is already a venue — returned from storage without refetching. */
  shared: boolean;
}

export interface ProbeProblem {
  status: 'needs_decision' | 'failure';
  normalizedUrl: string | null;
  code: ProbeErrorCode;
  severity: ProbeSeverity;
  message: string;
}

export type ProbeOutcome = ProbeSuccess | ProbeProblem;

/** How many free/paid probes a user gets, and over what window (GOI-72 §7). */
export const PROBE_FREE_PER_HOUR = 10;
export const PROBE_PAID_PER_DAY = 3;

// ─── Venue filter row (GOI-76) ───────────────────────────────────────────────

/**
 * Why a venue's count is what it is.
 *
 * A zero that means "nothing on this Tuesday" and a zero that means "we can't
 * read this venue any more" look identical on a chip, and the second one is a
 * data problem the user deserves to be told about rather than left to read as
 * an empty programme.
 */
export type VenueFilterStatus = 'active' | 'empty' | 'stale' | 'dark';

export interface VenueFilterOption {
  id: string;
  /** Derived from the name — what goes in the URL instead of a UUID. */
  slug: string;
  name: string;
  category: Category;
  /** Events at this venue under the current day/time filters. Never reflects
   *  the venue selection itself (GOI-76 §2). */
  count: number;
  status: VenueFilterStatus;
  /** When this venue was last read successfully, for the "stale" note. */
  lastScrapedAt: string | null;
}

/** A venue unread for longer than this is stale rather than quiet. */
export const VENUE_STALE_AFTER_DAYS = 7;

/**
 * Classify a venue for the filter row.
 *
 * Order matters: a venue we cannot read is `dark` whatever its counts say,
 * because every other reading of its numbers would be a guess.
 */
export function venueFilterStatus(
  v: {
    /** Events matching the current day/time filters. */
    count: number;
    /** Events upcoming at all, ignoring day/time. */
    upcomingTotal: number;
    /** Non-null when the last probe failed — see GOI-72. */
    probeErrorCode?: string | null;
    lastScrapedAt?: string | null;
  },
  now: Date = new Date(),
  staleAfterDays: number = VENUE_STALE_AFTER_DAYS,
): VenueFilterStatus {
  // Codes that mean "the page is fine, there is simply nothing on" are not a
  // reading failure — a venue between seasons is empty, not broken.
  const benign = new Set(['NO_EVENTS_FOUND', 'PAST_EVENTS_ONLY']);
  if (v.probeErrorCode && !benign.has(v.probeErrorCode)) return 'dark';

  if (v.lastScrapedAt) {
    const age = now.getTime() - Date.parse(v.lastScrapedAt);
    if (Number.isFinite(age) && age > staleAfterDays * 86_400_000) return 'stale';
  }

  if (v.upcomingTotal === 0) return 'empty';
  return 'active';
}

/** Human sentence for a chip's title/aria-description (GOI-76 §2, §7). */
export function venueStatusNote(
  status: VenueFilterStatus,
  count: number,
  lastScrapedAt: string | null,
  now: Date = new Date(),
): string | null {
  switch (status) {
    case 'dark':
      return 'We can’t currently read this venue’s listings';
    case 'stale': {
      const days = lastScrapedAt
        ? Math.floor((now.getTime() - Date.parse(lastScrapedAt)) / 86_400_000)
        : null;
      return days === null || !Number.isFinite(days)
        ? 'Last updated a while ago'
        : `Last updated ${days} day${days === 1 ? '' : 's'} ago`;
    }
    case 'empty':
      return 'This venue has no events listed right now';
    default:
      return count === 0 ? 'Nothing on in this period' : null;
  }
}

/**
 * URL-safe form of a venue name. Used instead of the UUID so a shared link
 * reads as `?venues=muranow,iluzjon` — and so a link keeps working across a
 * database that was reseeded with new ids.
 */
export function venueSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Polish ł has no combining form, so NFD leaves it alone.
    .replace(/ł/gi, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Event classification (GOI-80) ───────────────────────────────────────────

/**
 * What kind of *thing* an event is, as opposed to what shape it has in time.
 *
 * The ticket calls this field `category`. It is stored as `contentCategory`
 * because `Event.category` already exists and means something else — the
 * venue-derived cinema/theatre/exhibition/comedy/music/other. Overloading that
 * name would have silently corrupted every existing filter that reads it, so
 * the two live side by side.
 *
 * Flat, and deliberately not nested under the venue's category: CSW Zamek
 * Ujazdowski is a museum that runs a real cinema programme, so `screening` on
 * a museum venue is correct, not a validation error.
 *
 * Append-only. These strings persist inside saved folder filters, so a value
 * must never be renamed or renumbered.
 */
export type ContentCategory =
  | 'exhibition'
  | 'guided_tour'
  | 'workshop'
  | 'screening'
  | 'lecture'
  | 'concert'
  | 'performance'
  | 'festival'
  | 'other';

export const CONTENT_CATEGORIES: ContentCategory[] = [
  'exhibition', 'guided_tour', 'workshop', 'screening',
  'lecture', 'concert', 'performance', 'festival', 'other',
];

export function isContentCategory(v: unknown): v is ContentCategory {
  return typeof v === 'string' && (CONTENT_CATEGORIES as string[]).includes(v);
}

/** How a row's `contentCategory` was decided — so a misclassification can be
 *  audited without re-running anything. */
export type CategorySource = 'structural' | 'keyword' | 'llm';

/** Cross-cutting, and deliberately not a category value (GOI-80 Field 3).
 *  "Warsztaty rodzinne" is a workshop AND family; folding family into the
 *  category vocabulary would swallow the workshop signal, which is the whole
 *  reason this is a separate field. */
export type Audience = 'family';

/**
 * Polish keyword pre-pass over the **title only** (GOI-80 Field 2, step 1).
 *
 * Never the description: a description mentions other event types constantly
 * ("po wystawie", "przed koncertem"), so matching on it would misfile most of
 * the catalogue.
 *
 * Order is the tie-break and is part of the contract — a title matching two
 * keywords resolves to the first entry here, which is what makes the pass
 * deterministic and testable.
 */
const KEYWORDS: [RegExp, ContentCategory][] = [
  // Stems, not whole words: oprowadzanie / oprowadzenie / oprowadzeniu.
  [/oprowadz|spacer/i, 'guided_tour'],
  [/warsztat/i, 'workshop'],
  [/pokaz|projekcj|seans/i, 'screening'],
  [/wykład|wyklad|spotkani|dyskusj|debat/i, 'lecture'],
  [/koncert/i, 'concert'],
  [/spektakl|performans/i, 'performance'],
  [/wystaw|ekspozycj/i, 'exhibition'],
];

export function classifyByKeyword(title: string): ContentCategory | null {
  const hay = (title ?? '').toLowerCase();
  for (const [re, category] of KEYWORDS) {
    if (re.test(hay)) return category;
  }
  return null;
}

/** Independent of category, by design — see {@link Audience}. */
const FAMILY = /dla dzieci|dla rodzin|rodzinn|najmłodsz|najmlodsz/i;

export function classifyAudience(title: string): Audience | null {
  return FAMILY.test(title ?? '') ? 'family' : null;
}

/**
 * The whole classification for one row (GOI-80).
 *
 * Structure wins. A row whose dates say "a run with no clock" is an
 * exhibition, and no keyword or model answer may overrule that — the temporal
 * shape is what selects the date predicate at query time, and getting it from
 * a guess would break date filtering rather than merely mislabel a chip.
 */
export interface ClassificationInput {
  title: string;
  /** True when the row is structurally a run: a date range with no clock. */
  isExhibitionShape: boolean;
  /** Category the model returned, when the keyword pass found nothing. */
  llmCategory?: string | null;
}

export interface Classification {
  contentCategory: ContentCategory;
  categorySource: CategorySource;
  audience: Audience | null;
  /** Set when the model disagreed with the structure — logged, never applied. */
  conflict: string | null;
}

export function classifyEvent(input: ClassificationInput): Classification {
  const audience = classifyAudience(input.title);

  // Structural rows never reach the keyword pass or the model.
  if (input.isExhibitionShape) {
    const conflict =
      input.llmCategory && input.llmCategory !== 'exhibition'
        ? `structure says exhibition, model said ${input.llmCategory}`
        : null;
    return { contentCategory: 'exhibition', categorySource: 'structural', audience, conflict };
  }

  const keyword = classifyByKeyword(input.title);
  if (keyword) {
    return { contentCategory: keyword, categorySource: 'keyword', audience, conflict: null };
  }

  if (input.llmCategory) {
    // Anything outside the closed vocabulary becomes 'other' rather than
    // entering the set — the vocabulary is a contract with saved filters.
    return {
      contentCategory: isContentCategory(input.llmCategory) ? input.llmCategory : 'other',
      categorySource: 'llm',
      audience,
      conflict: isContentCategory(input.llmCategory)
        ? null
        : `model returned "${input.llmCategory}", outside the vocabulary`,
    };
  }

  return { contentCategory: 'other', categorySource: 'keyword', audience, conflict: null };
}

/**
 * Drop values a saved filter carries that this version doesn't know (GOI-80,
 * persistence contract). A filter saved by a newer build — or by one rolled
 * back since — keeps every value that still parses instead of erroring.
 */
export function keepKnownCategories(values: unknown): ContentCategory[] {
  if (!Array.isArray(values)) return [];
  return values.filter(isContentCategory);
}

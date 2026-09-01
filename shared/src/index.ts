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
  /**
   * Set when a successful scrape stopped listing an event somebody had saved
   * (GOI-101). Such a row is kept rather than deleted, so their bookmark
   * survives to be told about — but it is not on, and every listing excludes
   * it. Only the reader's own "want to go" list still shows it.
   */
  cancelledAt?: string | null;
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

/**
 * The two independent things a newsletter's timing used to conflate (GOI-100).
 *
 * `NewsletterSendCadence` is the **envelope**: when an email leaves, one per
 * config. `NewsletterRuleCadence` is the **contents**: how often a category
 * turns up *inside* the issues that go out. A config of "cinema daily, museums
 * weekly, theatre weekly" described neither — it said something about three
 * sections and nothing about when anyone would be emailed, so the scheduler
 * had to guess a send rhythm out of the busiest section.
 *
 * Separating them is what makes the coverage window derivable rather than
 * configured. See `deriveWindow`.
 */
export type NewsletterSendCadence = 'daily' | 'weekly' | 'monthly';

/**
 * How often a category appears inside the issues.
 *
 * `every_issue` rather than `daily` on purpose: the rule is relative to the
 * send schedule, and "daily" was a lie in a weekly newsletter. A category can
 * never appear more often than the envelope carrying it.
 */
export type NewsletterRuleCadence = 'every_issue' | 'weekly' | 'monthly';

/** Kept for the sweep's own vocabulary and the public API (GOI-87), which
 *  still speak of a subscription's frequency. */
export type NewsletterFrequency = NewsletterSendCadence;

/** How much of each event a section shows: title and time only, a trimmed
 *  one-liner, or the whole blurb. */
export type NewsletterDetail = 'line' | 'short' | 'full';

/**
 * Time-of-day narrowing, per category rather than per newsletter (GOI-100).
 *
 * It was one global "only events after" setting, and that setting silently
 * emptied every museum section in the product: exhibitions are daytime, so
 * "only after 18:00" — a perfectly reasonable thing to want for cinema — meant
 * a museums section that could never match anything. A reader who set it saw
 * museums vanish and had no way to connect the two.
 */
export type NewsletterTimeFilter = 'any' | 'after_17' | 'after_18' | 'after_19' | 'after_20';

/** The hour a `NewsletterTimeFilter` cuts at, or null for "any". */
export function timeFilterHour(filter: NewsletterTimeFilter): number | null {
  return filter === 'any' ? null : Number(filter.slice('after_'.length));
}

/** The filter expressing "at or after this hour", for migrating the old
 *  global setting and for the settings UI. Anything unrepresentable — 6am,
 *  say — rounds down to the nearest offered option, or to `any`. */
export function timeFilterForHour(hour: number | null | undefined): NewsletterTimeFilter {
  if (hour == null) return 'any';
  if (hour >= 20) return 'after_20';
  if (hour >= 19) return 'after_19';
  if (hour >= 18) return 'after_18';
  if (hour >= 17) return 'after_17';
  return 'any';
}

/**
 * One category's own place in the brief: how often it turns up, how much it
 * says, and what time of day it will consider.
 *
 * `category` matches either a built-in event category ("cinema") or one of the
 * reader's own venue tags ("arthouse") — whichever they picked. The two share
 * one namespace deliberately (see `eventInCategory`): a tag is just another
 * name a venue answers to, and a rule does not need to know which kind it got.
 */
export interface NewsletterCategoryRule {
  category: string;
  cadence: NewsletterRuleCadence;
  /**
   * Which issue carries it, when `cadence` is weekly and the newsletter sends
   * daily (0=Sun … 6=Sat). Meaningless otherwise, and stored as null rather
   * than as a value that does nothing.
   */
  cadenceWeekday: number | null;
  detail: NewsletterDetail;
  timeFilter: NewsletterTimeFilter;
  /**
   * Look further ahead than the derived window. The one thing cadence cannot
   * express: theatre runs sell out, so a weekly theatre section may want to
   * name what is on in three weeks even though it will be printed again next
   * week. Null means "derive it", which is right almost always.
   */
  lookaheadDays: number | null;
  /** Section order within an issue. */
  sortOrder: number;
}

/**
 * The "want to go" reminder queue's settings (GOI-101).
 *
 * Not a digest section, which is why it has its own block rather than a rule:
 * it is a queue of events the reader already chose, escalating as they get
 * closer, and it inherits neither cadence nor depth nor window from anything.
 */
export interface NewsletterWantToGo {
  enabled: boolean;
  /** How far ahead a saved event starts being reminded about (1–30). */
  horizonDays: number;
  /** Report cancellations, reschedules, moves and sell-outs. */
  changesEnabled: boolean;
  /** Allow an off-schedule email for an urgent change. */
  urgentSend: boolean;
}

export const DEFAULT_WANT_TO_GO: NewsletterWantToGo = {
  enabled: true,
  horizonDays: 7,
  changesEnabled: true,
  urgentSend: true,
};

/**
 * How a reader gets their brief.
 *
 * Filing a PDF on a connected drive used to be an *addition* to the email —
 * everyone got mailed, and a drive, if connected, also got a copy. That made
 * the email the product and the file a convenience, which is the assumption
 * `deliverBriefToDrives` was written under: it never throws, because a drive
 * being full must not turn a brief that was successfully emailed into a failed
 * send.
 *
 * `drive` breaks that assumption on purpose. For a reader who chose it there
 * is no email, so the filed PDF *is* the delivery, and a drive that is full or
 * revoked is a failed send rather than a footnote. The sweep says so.
 */
export type NewsletterDelivery = 'email' | 'drive' | 'both';

/** Does this delivery choice involve sending an email? */
export function deliversByEmail(delivery: NewsletterDelivery): boolean {
  return delivery === 'email' || delivery === 'both';
}

/** Does it involve filing a PDF on a connected drive? */
export function deliversToDrive(delivery: NewsletterDelivery): boolean {
  return delivery === 'drive' || delivery === 'both';
}

export interface NewsletterSettings {
  /** The config's own id. A reader may have one per folder (GOI-100). */
  id: string;
  /**
   * The folder whose venues this newsletter draws on, or null for a config
   * that predates folders / covers everything the reader follows.
   *
   * The folder owns the venue set; `venueIds` only *narrows* it. Two sources
   * of truth for "which venues" is how they drift, so unchecking a venue here
   * must never write to the folder.
   */
  folderId: string | null;
  /** User-facing label, so several configs can be told apart. */
  name: string;
  /**
   * The address the brief is emailed to, and the config's own identity — the
   * public API (GOI-87) addresses subscriptions by it. Required whatever
   * `delivery` says, since a drive-only reader still has an account.
   */
  email: string;
  /** Name the brief greets you by; null greets you without one. */
  recipientName: string | null;
  /** Email, a PDF filed on a connected drive, or both. */
  delivery: NewsletterDelivery;
  /** When an issue is sent. */
  sendCadence: NewsletterSendCadence;
  /** Weekday weekly issues go out on (0=Sun … 6=Sat); null unless weekly. */
  sendWeekday: number | null;
  /** Day monthly issues go out on (1–28); null unless monthly. Capped at 28
   *  so every month has one. */
  sendDayOfMonth: number | null;
  /** Hour the issue is sent at (0-23), in `timezone`. */
  sendHour: number;
  /** Minute past `sendHour` (0-59). */
  sendMinute: number;
  timezone: string;
  /** Venues within the folder this newsletter covers; empty = all of them. */
  venueIds: string[];
  /** Only include events starting before this hour (0-23). No UI; the
   *  after-hour half of this pair became `NewsletterCategoryRule.timeFilter`. */
  beforeHour: number | null;
  /** Skip an issue with nothing in it rather than mailing an empty page. */
  suppressEmptyIssues: boolean;
  wantToGo: NewsletterWantToGo;
  /** Per-category cadence, depth, time filter and lookahead. */
  categoryRules: NewsletterCategoryRule[];
  enabled: boolean;
  lastSentAt: string | null;
}

/**
 * Where a saved event has got to, as the newsletter reports it (GOI-101).
 *
 * These are *escalation* states, not categories: one saved play passes through
 * several of them as its date approaches, and each is a different thing to
 * tell someone. That is why the state is the dedup key rather than the event —
 * see `newsletter_sent_events`.
 */
export type WantToGoState = 'tomorrow' | 'this_week' | 'last_chance';

/** What a change to a saved event was. */
export type EventChangeType = 'cancelled' | 'rescheduled' | 'moved' | 'sold_out';

/**
 * Which state a saved event is in for this issue, or null when it is outside
 * the reader's horizon and there is nothing to say yet.
 *
 * `last_chance` wins over the other two, because "this is the final
 * performance" is the more urgent fact even on the day before: a reader who is
 * told only "tomorrow" will assume there is another one next week.
 *
 * `siblings` is every other future occurrence of the same production, which is
 * what "final performance" is measured against.
 */
export function wantToGoState(
  event: { id: string; startsAt: string; endsAt?: string | null; kind?: string | null },
  siblings: { id: string; startsAt: string }[],
  now: Date,
  horizonDays: number,
): WantToGoState | null {
  const starts = new Date(event.startsAt);
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);

  // An exhibition runs continuously, so its urgency is its closing date
  // rather than its start — which has usually long passed.
  const closes = event.kind === 'exhibition' && event.endsAt ? new Date(event.endsAt) : null;
  if (closes) {
    if (closes < now) return null;
    return closes <= horizon ? 'last_chance' : null;
  }

  if (starts < now || starts > horizon) return null;

  // The final performance of a run. Anything later than this one, for the same
  // production, means it is not.
  const isLast = !siblings.some((s) => s.id !== event.id && new Date(s.startsAt) > starts);
  if (isLast && siblings.length > 1) return 'last_chance';

  return isTomorrow(starts, now) ? 'tomorrow' : 'this_week';
}

/** Is `at` on the calendar day after `now`, in Warsaw? */
function isTomorrow(at: Date, now: Date): boolean {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(d);
  return day(at) === day(new Date(now.getTime() + 86_400_000));
}

/**
 * Group occurrences into productions (GOI-101).
 *
 * There is no production-level grouping in the schema — an event row is one
 * performance — so a run of the same play is derived from `(venueId, title)`.
 * That is a heuristic and it has a known failure: two genuinely different
 * works sharing a title at one venue would be folded together, and a
 * production that tours between venues would be split. Both are rarer than the
 * ordinary case it gets right, and the alternative is inventing a productions
 * table for one caller, which is a schema change that should be made when
 * something else needs it too.
 */
export function productionKey(event: { venueId: string; title: string }): string {
  return `${event.venueId}::${event.title.trim().toLowerCase()}`;
}

/** Days in the span a send cadence covers — the gap between two issues. */
export function sendCadenceDays(cadence: NewsletterSendCadence): number {
  if (cadence === 'daily') return 1;
  return cadence === 'weekly' ? 7 : 30;
}

/**
 * How far a category rule may be set relative to the envelope carrying it.
 *
 * A category cannot appear more often than an issue is sent, so a weekly
 * newsletter has no separate "once a week" — that *is* every issue — and a
 * monthly one offers nothing but `every_issue`. The settings UI shows the
 * unavailable options disabled rather than absent (GOI-102), so a reader
 * understands why a choice vanished instead of wondering where it moved.
 */
export function allowedRuleCadences(send: NewsletterSendCadence): NewsletterRuleCadence[] {
  if (send === 'daily') return ['every_issue', 'weekly', 'monthly'];
  if (send === 'weekly') return ['every_issue', 'monthly'];
  return ['every_issue'];
}

/**
 * The window of events a section covers: from this issue to the next issue
 * that will carry the same category (GOI-100).
 *
 * Derived rather than configured, and that is the point. Anything the reader
 * could set here they could set wrong — a weekly theatre section looking one
 * day ahead reports a seventh of the week and silently loses the rest, and a
 * daily cinema section looking a week ahead repeats itself six times. Deriving
 * it from the two cadences guarantees the one property that matters: coverage
 * with no gaps and no repeats.
 *
 * `lookaheadDays` is the deliberate exception, and it only moves `to`. When it
 * exceeds the cadence the windows overlap, and an event will fall in two
 * issues — that is what the send-state dedup (GOI-101) is for, and not
 * something this function should try to compensate for by moving `from`.
 */
export function deriveWindow(
  config: Pick<NewsletterSettings, 'sendCadence'>,
  rule: Pick<NewsletterCategoryRule, 'cadence' | 'lookaheadDays'>,
  issueDate: Date,
): { from: Date; to: Date } {
  const from = new Date(issueDate);
  const days = rule.lookaheadDays ?? coverageDays(config.sendCadence, rule.cadence);
  return { from, to: new Date(from.getTime() + days * 86_400_000) };
}

/** Days between two issues carrying the same category. */
function coverageDays(send: NewsletterSendCadence, rule: NewsletterRuleCadence): number {
  // Every issue carries it, so the gap is simply the send gap.
  if (rule === 'every_issue') return sendCadenceDays(send);
  if (rule === 'weekly') return 7;
  // Monthly. In a weekly newsletter the next issue carrying it is four issues
  // away, which is 28 days rather than a calendar month — using 30 there would
  // overlap the following month's section by two days every time.
  return send === 'weekly' ? 28 : 30;
}

// ─── Festivals ───────────────────────────────────────────────────────────────

/**
 * Which listing a festival belongs to (GOI-68).
 *
 * Festivals started as a cinema-only idea and the type said so — the hosts
 * field was called `cinemas`. A theatre festival filed under a field of that
 * name is a lie the compiler can't catch, so the field is `venues` and the
 * listing it belongs to is stated outright.
 *
 * A narrow set on purpose: these are the categories that actually run
 * festivals. It is a subset of `Category`, not the whole of it — there is no
 * such thing as an "other" festival worth putting on a page.
 */
export type FestivalCategory = 'cinema' | 'theatre' | 'music';

/** Whether a listing has festivals of its own (GOI-68). Narrows a `Category`
 *  from the filter bar down to the ones festivals are filed under. */
export function isFestivalCategory(category: string): category is FestivalCategory {
  return category === 'cinema' || category === 'theatre' || category === 'music';
}

export interface Festival {
  id: string;
  name: string;
  url: string;
  /** The listing this festival belongs under. */
  category: FestivalCategory;
  /** Venue names hosting the festival. */
  venues: string[];
  city: string;
  /** ISO dates (YYYY-MM-DD), inclusive. */
  startDate: string;
  endDate: string;
  description: string;
  status: 'ongoing' | 'upcoming';
  /**
   * The festival's own banner artwork, taken from its site (GOI-99), or null
   * where we don't have one. Null is an ordinary case, not a gap to be filled
   * with a placeholder: a festival announces itself in its own poster or not
   * at all, and a grey rectangle saying "no image" announces nothing. The
   * banner sets the name in the app's own display type instead.
   */
  imageUrl: string | null;
}

/**
 * How far ahead a festival is worth a banner (GOI-99).
 *
 * Two weeks is the window in which "there is a festival on" is *news* — near
 * enough to change what you do with a given evening, far enough to still buy a
 * ticket. Beyond it a banner is an advertisement occupying the top of a page
 * the reader opened to see what is on tonight, and it is the listing further
 * down that wants the festival, not the masthead.
 */
export const FESTIVAL_BANNER_LEAD_DAYS = 14;

/**
 * The festivals that earn the top of the page: on now, or starting within
 * `FESTIVAL_BANNER_LEAD_DAYS` (GOI-99). Soonest first, ongoing ones ahead of
 * upcoming ones — what is on today outranks what opens on Friday.
 *
 * Dates are compared on the Warsaw calendar day, like everything else that
 * decides whether an event is "on": a festival's opening night is a day in
 * Warsaw, not an instant in UTC, and a server in another zone must not
 * disagree with the page about which day it is.
 */
export function bannerFestivals<T extends Festival>(festivals: T[], now: Date = new Date()): T[] {
  const today = warsawDayKey(now);
  const until = warsawDayKey(new Date(now.getTime() + FESTIVAL_BANNER_LEAD_DAYS * 86_400_000));
  return festivals
    .filter((f) => f.endDate >= today && f.startDate <= until)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** YYYY-MM-DD on the Warsaw calendar. */
function warsawDayKey(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(at);
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
  const hosts = festival.venues.map(foldVenueName).filter(Boolean);
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

/**
 * The "Elsewhere" discovery search (GOI-92).
 *
 * One search costs a model call plus one probe per candidate, so the candidate
 * cap and the per-hour search cap are the whole spend control. Eight is chosen
 * against `PROBE_FREE_PER_HOUR`: a full search plus one retry stays inside the
 * free probe allowance, so a user is never told "rate limited" halfway through
 * a list they just asked for. The ticket suggests 20; the site is invite-only,
 * and eight good matches beat twenty guesses.
 */
export const VENUE_SUGGEST_MAX_CANDIDATES = 8;
export const VENUE_SUGGEST_PER_HOUR = 5;
/** How many candidates are probed at once. The ticket's 3–5 — enough that a
 *  list of eight resolves quickly, few enough that one search is not a burst
 *  of fetches at some venue's small server. */
export const VENUE_SUGGEST_PROBE_CONCURRENCY = 4;

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
  /** The venue's own site. Shown in the venue picker (GOI-89) so a name that
   *  means nothing to the reader can still be identified — and so they can go
   *  straight to the source. */
  url: string;
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

/**
 * Where briefs are filed on a connected cloud drive (GOI-91): a single folder
 * at the root of the user's drive, named by them.
 *
 * The rules live in `shared` rather than beside the drive code because three
 * places have to agree on them — the field that edits the name, the procedure
 * that accepts it, and the provider that writes it to the drive — and a
 * browser-side bound that is looser than the server's is just a rejected save
 * the user could have been warned about while typing.
 */
export const DEFAULT_DRIVE_FOLDER = 'Afisz.ka';

/**
 * The drives a brief can be filed on (GOI-91, GOI-93).
 *
 * Here rather than beside the backend's provider clients for the same reason
 * as the folder rules above: the settings card renders one block per provider
 * and the router validates the id it is given, so both sides have to agree on
 * the list. A union rather than a bare string means adding a provider is a
 * compile error everywhere that has to handle it, not a runtime surprise.
 */
export const DRIVE_PROVIDER_IDS = ['google', 'dropbox'] as const;
export type DriveProviderId = (typeof DRIVE_PROVIDER_IDS)[number];

/** Longest folder name accepted. Drive's own limit is far higher; this is a
 *  UI-shaped bound, so the name stays readable in the Newsletter tab. */
export const MAX_DRIVE_FOLDER_NAME = 100;

/**
 * Trim and validate a user-supplied folder name, or throw with a message the
 * UI can show verbatim.
 *
 * Control characters are rejected because Drive accepts them and then displays
 * a name nobody can retype or search for; `/` is rejected because a name
 * carrying one reads as a path, and nested folders are not what it produces.
 */
export function normalizeDriveFolderName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new Error('Folder name cannot be empty.');
  if (name.length > MAX_DRIVE_FOLDER_NAME) {
    throw new Error(`Folder name cannot be longer than ${MAX_DRIVE_FOLDER_NAME} characters.`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Folder name cannot contain control characters.');
  }
  if (name.includes('/')) {
    throw new Error('Folder name cannot contain "/" \u2014 briefs go in one folder, not a path.');
  }
  return name;
}

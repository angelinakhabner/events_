import { pgTable, text, timestamp, jsonb, uuid, index, integer, primaryKey, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const venues = pgTable('venues', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull().unique(),
  city: text('city').notNull(),
  country: text('country').notNull(),
  category: text('category').notNull(),
  language: text('language').notNull().default('en'),
  timezone: text('timezone').notNull().default('Europe/Warsaw'),
  createdAt: timestamp('created_at').notNull().defaultNow(),

  // ── Probe state (GOI-72 §6) ────────────────────────────────────────────────
  // One venue has exactly one source method, so these are columns rather than
  // a `venue_sources` table.
  /** Canonical form of `url` — the real dedup key. `url` keeps whatever the
   *  first user pasted, which is why two spellings of one venue could both be
   *  added before this existed. Nullable until the backfill probes each row. */
  normalizedUrl: text('normalized_url').unique(),
  /** The candidate that actually yielded events, which is often deeper than
   *  the pasted homepage. This is what the scraper should fetch. */
  sourceUrl: text('source_url'),
  /** jsonld | ical | wp_rest | wp_rest_posts | rss | llm_extract | firecrawl | manual.
   *  The first three are free to refetch: the daily cron can skip the hash
   *  check and the model call entirely for them. */
  sourceMethod: text('source_method'),
  sourceConfidence: text('source_confidence'),
  /** This venue only renders in a browser — every sweep of it costs money, so
   *  it has to be visible rather than inferred from the bill. */
  requiresPaidFetch: boolean('requires_paid_fetch').notNull().default(false),
  lastProbedAt: timestamp('last_probed_at', { withTimezone: true }),
  /** Null when healthy. Feeds the venue status model: a venue whose last probe
   *  said NO_EVENTS_FOUND is empty, not broken. */
  probeErrorCode: text('probe_error_code'),
  /** The whole ProbeOutcome, for debugging a venue that went quiet. */
  probeResult: jsonb('probe_result').$type<Record<string, unknown>>(),
});

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: text('device_id').notNull(),
    name: text('name').notNull(),
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
    venueIds: text('venue_ids').array().notNull().default(sql`ARRAY[]::text[]`),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    deviceIdx: index('folders_device_id_idx').on(t.deviceId),
  }),
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id').notNull().references(() => venues.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    /** For an exhibition this is the opening date at local midnight — the
     *  range's left edge, not a showtime. See `kind`. */
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** Closing date for an exhibition (required for that kind, see the
     *  events_exhibition_has_range check in 0019); optional end time for a
     *  timed event. */
    endsAt: timestamp('ends_at', { withTimezone: true }),
    /** 'timed' | 'exhibition' (GOI-67). An exhibition runs over a date range
     *  and has no clock time; everything else starts at an hour. */
    kind: text('kind').notNull().default('timed'),
    category: text('category').notNull(),
    language: text('language'),
    director: text('director'),
    cast: text('cast').array(),
    durationMinutes: integer('duration_minutes'),
    priceMin: integer('price_min'),
    priceMax: integer('price_max'),
    sourceUrl: text('source_url').notNull(),
    sourceId: text('source_id'),

    // ── Classification (GOI-80) ───────────────────────────────────────────
    // `category` above is the venue-derived one (cinema/theatre/…). These are
    // about the *content*: what kind of thing this row is, who it's for, and
    // how we decided. Kept as separate columns because the ticket is explicit
    // that they are three independent fields, not one enum and not a tree.
    /** exhibition | guided_tour | workshop | screening | lecture | concert |
     *  performance | festival | other. Append-only: these strings live inside
     *  saved folder filters. */
    contentCategory: text('content_category'),
    /** structural | keyword | llm — lets a misclassification be audited
     *  without re-running the scrape that produced it. */
    categorySource: text('category_source'),
    /** 'family' or null. Cross-cutting on purpose: "Warsztaty rodzinne" is a
     *  workshop AND family, and folding family into the category vocabulary
     *  would swallow the workshop signal. */
    audience: text('audience'),

    scrapedAt: timestamp('scraped_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    venueIdx: index('events_venue_id_idx').on(t.venueId),
    startsAtIdx: index('events_starts_at_idx').on(t.startsAt),
  }),
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  // The list whose venues the user is currently looking at. Only venues
  // reachable through some user's *active* list get scraped (plus venues with
  // no subscribers at all — the shared seed powering the public home).
  // No FK reference here to avoid a circular table definition; the SQL
  // migration declares REFERENCES user_lists(id) ON DELETE SET NULL.
  activeListId: uuid('active_list_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// A named grouping of a user's venue subscriptions (e.g. "Warsaw", "Poznan").
export const userLists = pgTable(
  'user_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('user_lists_user_id_idx').on(t.userId),
    // A second unique key exists that drizzle cannot express here: a unique
    // index on (user_id, lower(btrim(name))), declared in 0025. It is what
    // makes "berlin" and "Berlin " the same folder, and what lets the
    // Elsewhere flow auto-create a city folder with a plain ON CONFLICT
    // instead of a read-then-write race (GOI-92).
  }),
);

// Magic-link tokens. Only the SHA-256 of the token is stored, so a DB leak
// can't be replayed as a login link. Single-use (used_at) and short-lived.
export const authTokens = pgTable('auth_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  email: text('email').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Bearer sessions minted on magic-link verification. Hashed for the same
// reason as auth_tokens.
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('sessions_user_id_idx').on(t.userId) }),
);

// A user's subscription to a (shared) venue, with personal overrides. The
// venue row itself stays global — venues.url is unique, so 1000 users adding
// Kinoteka share one row and it is scraped once. Overrides are what the user
// sees; null means "use the venue's own value".
export const userVenues = pgTable(
  'user_venues',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    venueId: uuid('venue_id').notNull().references(() => venues.id, { onDelete: 'cascade' }),
    // Which of the user's lists this subscription lives in. Null only for
    // pre-lists legacy rows (the 0006 migration backfills them into "Warsaw").
    listId: uuid('list_id').references(() => userLists.id, { onDelete: 'cascade' }),
    nameOverride: text('name_override'),
    categoryOverride: text('category_override'),
    // Free-form personal tags ("date night", "walking distance"). Personal
    // like the overrides — the shared venue row carries none.
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    // Personal scrape horizon in days. The venue's effective horizon is the
    // max over its subscribers (falling back to the category default).
    windowDays: integer('window_days'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.venueId] }),
    venueIdx: index('user_venues_venue_id_idx').on(t.venueId),
    listIdx: index('user_venues_list_id_idx').on(t.listId),
  }),
);

// "Want to go" bookmarks for logged-in users.
export const wantToGo = pgTable(
  'want_to_go',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    // Set when the user marks the entry seen; it stays on the list, filed
    // under "Seen", instead of being removed.
    seenAt: timestamp('seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.eventId] }),
    userIdx: index('want_to_go_user_id_idx').on(t.userId),
  }),
);

// A read-only public link to a user's "want to go" list (GOI-47). One row per
// user: sharing again after revoking mints a fresh token, so an old link stops
// resolving instead of quietly coming back to life.
export const wantToGoShares = pgTable('want_to_go_shares', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Unguessable URL segment. The link *is* the credential — anyone holding
   *  it can read the list, which is what sharing means here. */
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const scrapeRuns = pgTable(
  'scrape_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id').notNull().references(() => venues.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status').notNull(),
    eventsFound: integer('events_found'),
    errorMessage: text('error_message'),
    rawHash: text('raw_hash'),
    /** Vendor credits this run spent rendering the page (GOI-72 §4). Zero for
     *  every free-tier run, which is nearly all of them. */
    firecrawlCredits: integer('firecrawl_credits').notNull().default(0),
    /** Detail pages fetched during description enrichment (GOI-79). The
     *  number to watch: it is one HTTP request and one model call each. */
    detailFetches: integer('detail_fetches').notNull().default(0),
    detailInputTokens: integer('detail_input_tokens').notNull().default(0),
    detailOutputTokens: integer('detail_output_tokens').notNull().default(0),
  },
  (t) => ({
    venueIdx: index('scrape_runs_venue_id_idx').on(t.venueId),
    startedIdx: index('scrape_runs_started_at_idx').on(t.startedAt),
  }),
);

// A logged-in user's personal film list: titles they want to watch and titles
// they've seen (with where + a short note). Unique per user by lower(title) —
// enforced in SQL (films_user_title_unique); the store checks it too so the
// in-memory variant behaves the same.
export const films = pgTable(
  'films',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('want'),
    watchedVenue: text('watched_venue'),
    comment: text('comment'),
    watchedAt: timestamp('watched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('films_user_id_idx').on(t.userId),
  }),
);

// Newsletter briefs: one subscription per user. venue_ids scope the brief;
// after/before hour narrow it to e.g. "everything after 6 pm". last_sent_at
// lets the sender skip users already briefed in the current cadence window.
export const newsletterSubscriptions = pgTable('newsletter_subscriptions', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  /** What the brief calls the reader; null = greet without a name. */
  recipientName: text('recipient_name'),
  frequency: text('frequency').notNull().default('weekly'),
  venueIds: text('venue_ids').array().notNull().default(sql`ARRAY[]::text[]`),
  afterHour: integer('after_hour'),
  beforeHour: integer('before_hour'),
  /** Warsaw hour the brief goes out at (0-23). */
  sendHour: integer('send_hour').notNull().default(8),
  /** Minute past that hour (0-59). */
  sendMinute: integer('send_minute').notNull().default(0),
  /** Weekday weekly briefs go out on, JS convention (0=Sun … 6=Sat). */
  sendWeekday: integer('send_weekday').notNull().default(1),
  /** Per-category cadence + detail; see NewsletterCategoryRule. Empty = one
   *  brief covering everything on the subscription's own frequency. */
  categoryRules: jsonb('category_rules')
    .$type<{ category: string; frequency: string; detail: string }[]>()
    .notNull()
    .default([]),
  enabled: boolean('enabled').notNull().default(true),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A user's connected cloud drive, where their briefs get filed (GOI-91).
 *
 * One row per user per provider, so a user can have Google Drive and (once a
 * second provider exists) another one at the same time without either
 * displacing the other.
 *
 * `refresh_token` is the sensitive column: unlike the token tables above this
 * one cannot store a hash, because the value has to be *replayed* to Google on
 * every scheduled upload rather than merely compared. It is therefore the one
 * secret in this database that a dump would expose, which is why the scope
 * granted is `drive.file` — access limited to files AFISZ itself created, not
 * to the user's Drive.
 */
export const driveConnections = pgTable(
  'drive_connections',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** 'google' today; the column is text so a new provider needs no migration. */
    provider: text('provider').notNull(),
    refreshToken: text('refresh_token').notNull(),
    /** Which of the user's accounts the folder lives in — they often have more
     *  than one, and "which Drive did I connect?" is otherwise unanswerable. */
    accountEmail: text('account_email'),
    folderName: text('folder_name').notNull().default('Afisz.ka'),
    /** Cached so the common upload costs no folder search. Re-verified before
     *  use: a user can bin the folder, and uploading into a trashed folder
     *  succeeds while putting the brief where nobody will look. */
    folderId: text('folder_id'),
    /** Set on a failed upload, cleared by the next success. A drive that has
     *  quietly stopped receiving briefs is the failure worth surfacing. */
    lastError: text('last_error'),
    lastUploadAt: timestamp('last_upload_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.provider] }),
  }),
);

import { pgTable, text, timestamp, jsonb, uuid, index, integer, primaryKey, boolean, unique } from 'drizzle-orm/pg-core';
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
    /**
     * Set when a successful scrape stopped listing an event that somebody had
     * saved (GOI-101). The row is kept rather than deleted so their bookmark
     * survives to be told about; every listing query excludes it.
     */
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
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

/**
 * A newsletter config (GOI-100). Was `newsletter_subscriptions`, one row per
 * user; now one row per user *per folder*, because the venues a newsletter
 * covers are a folder's venues and a reader has more than one folder.
 *
 * The table keeps its name and its lineage — 0026 gives it a surrogate key and
 * the new columns rather than starting a fresh table, so every existing
 * subscription carries forward with its email, schedule and history intact.
 *
 * `send_*` is the envelope: when an issue leaves. What goes *in* an issue is
 * `newsletter_category_rules` plus the want-to-go queue. Those were one field
 * before, which is why the scheduler had to infer a send rhythm from the
 * busiest section.
 */
export const newsletterSubscriptions = pgTable(
  'newsletter_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** The folder whose venues this newsletter draws on. Null for a config
     *  that predates folders, which covers everything the reader follows. */
    folderId: uuid('folder_id').references(() => userLists.id, { onDelete: 'cascade' }),
    /** User-facing label, so several configs can be told apart. */
    name: text('name').notNull().default('Newsletter'),
    email: text('email').notNull(),
    /** What the brief calls the reader; null = greet without a name. */
    recipientName: text('recipient_name'),
    /** email | drive | both — where the brief goes. A drive-only reader is
     *  never mailed, so for them the filed PDF is the delivery rather than a
     *  copy of one, and a failed upload is a failed send. */
    delivery: text('delivery').notNull().default('email'),
    /** daily | weekly | monthly — when an issue is sent. */
    sendCadence: text('send_cadence').notNull().default('weekly'),
    /** Venues within the folder the brief covers; empty = all of them. It
     *  narrows the folder and never writes back to it. */
    venueIds: text('venue_ids').array().notNull().default(sql`ARRAY[]::text[]`),
    /** The after-hour half of this pair moved onto each category rule in 0026
     *  — see NewsletterTimeFilter for why. This half has no UI and stays. */
    beforeHour: integer('before_hour'),
    /** Hour the brief goes out at (0-23), in `timezone`. */
    sendHour: integer('send_hour').notNull().default(8),
    /** Minute past that hour (0-59). */
    sendMinute: integer('send_minute').notNull().default(0),
    /** Weekday weekly issues go out on, JS convention (0=Sun … 6=Sat). */
    sendWeekday: integer('send_weekday'),
    /** Day monthly issues go out on. Capped at 28 so every month has one. */
    sendDayOfMonth: integer('send_day_of_month'),
    timezone: text('timezone').notNull().default('Europe/Warsaw'),
    /** Skip an issue with nothing in it rather than mailing an empty page. */
    suppressEmptyIssues: boolean('suppress_empty_issues').notNull().default(true),
    /** The want-to-go queue's settings; see NewsletterWantToGo (GOI-101). */
    wantToGo: jsonb('want_to_go')
      .$type<{
        enabled: boolean;
        horizonDays: number;
        changesEnabled: boolean;
        urgentSend: boolean;
      }>()
      .notNull()
      .default({ enabled: true, horizonDays: 7, changesEnabled: true, urgentSend: true }),
    enabled: boolean('enabled').notNull().default(true),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    /** When an urgent, off-schedule change email last went out (GOI-101).
     *  Separate from `last_sent_at` so an urgent send neither counts as the
     *  scheduled issue nor suppresses the next one. */
    lastUrgentAt: timestamp('last_urgent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('newsletter_subscriptions_user_id_idx').on(t.userId),
    // One newsletter per folder. Declared in 0026 as a partial unique index
    // (folder_id IS NOT NULL) plus a second one for the null case, which
    // drizzle cannot express here — a plain unique would let a user hold any
    // number of folderless configs, since NULL never equals NULL.
  }),
);

/**
 * One category's place inside a newsletter (GOI-100).
 *
 * A child table rather than the JSONB column it replaces (0013). The rules
 * gained a per-row time filter, a lookahead override and an order, the sweep
 * now reads them per issue rather than whole, and GOI-102's UI validates them
 * one row at a time — at which point "always read and written whole" had
 * stopped being true, which was the reason for the JSONB in the first place.
 */
export const newsletterCategoryRules = pgTable(
  'newsletter_category_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    configId: uuid('config_id')
      .notNull()
      .references(() => newsletterSubscriptions.id, { onDelete: 'cascade' }),
    /** An event category ("cinema") or one of the reader's venue tags. */
    category: text('category').notNull(),
    /** every_issue | weekly | monthly — how often it appears in an issue. */
    cadence: text('cadence').notNull().default('every_issue'),
    /** Which issue carries it, when cadence=weekly on a daily newsletter. */
    cadenceWeekday: integer('cadence_weekday'),
    /** line | short | full */
    depth: text('depth').notNull().default('short'),
    /** any | after_17 | after_18 | after_19 | after_20 */
    timeFilter: text('time_filter').notNull().default('any'),
    /** Overrides the derived coverage window when set. */
    lookaheadDays: integer('lookahead_days'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    configIdx: index('newsletter_category_rules_config_id_idx').on(t.configId),
    uniqueCategory: unique('newsletter_category_rules_config_category_key')
      .on(t.configId, t.category),
  }),
);

/**
 * What has already been said, and in what state (GOI-100, GOI-101).
 *
 * The key includes `state` rather than being `(config_id, event_id)`, and that
 * is the whole design. A saved play should be mentioned once as "this week",
 * again as "tomorrow", and again as "last chance" — three different things to
 * tell someone about one event — while never being mentioned twice in the same
 * state however many issues fall inside its horizon. A per-event flag cannot
 * express that; it can only choose between saying everything repeatedly and
 * saying each thing once.
 *
 * Ordinary digest sections use the literal state `'digest'`.
 */
export const newsletterSentEvents = pgTable(
  'newsletter_sent_events',
  {
    configId: uuid('config_id')
      .notNull()
      .references(() => newsletterSubscriptions.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.configId, t.eventId, t.state] }),
    // Retention sweep reads this: rows older than 120 days are dropped.
    sentAtIdx: index('newsletter_sent_events_sent_at_idx').on(t.sentAt),
  }),
);

/**
 * Changes the scraper noticed to an event that already existed (GOI-101).
 *
 * Written when a re-scrape finds a stored event whose time, venue or
 * availability has moved, so the want-to-go queue can tell a reader that
 * something they saved is no longer what they saved.
 */
export const eventChanges = pgTable(
  'event_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    /** cancelled | rescheduled | moved | sold_out */
    changeType: text('change_type').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventIdx: index('event_changes_event_id_idx').on(t.eventId),
    detectedIdx: index('event_changes_detected_at_idx').on(t.detectedAt),
  }),
);

/**
 * Invite tokens for the pre-auth access gate (GOI-83).
 *
 * Temporary by construction: this table plus one middleware file is the whole
 * feature, so opening the site up later is a delete, not an untangling.
 *
 * Only the SHA-256 of a token is stored. The raw token exists once, in the URL
 * printed by the create script, and nowhere else — a dump of this table hands
 * an attacker nothing usable.
 */
export const invites = pgTable(
  'invites',
  {
    tokenHash: text('token_hash').primaryKey(),
    /** Who or what it was minted for ("Kasia", "portfolio"). */
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null = never expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Set to revoke. Checked on *every* request, not only at exchange, so a
     *  cookie already issued from this token dies with it. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    useCount: integer('use_count').notNull().default(0),
  },
  (t) => ({
    labelIdx: index('invites_label_idx').on(t.label),
  }),
);

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

import { pgTable, text, timestamp, jsonb, uuid, index, integer, primaryKey } from 'drizzle-orm/pg-core';
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
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    category: text('category').notNull(),
    language: text('language'),
    director: text('director'),
    cast: text('cast').array(),
    durationMinutes: integer('duration_minutes'),
    priceMin: integer('price_min'),
    priceMax: integer('price_max'),
    sourceUrl: text('source_url').notNull(),
    sourceId: text('source_id'),
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    nameOverride: text('name_override'),
    categoryOverride: text('category_override'),
    // Personal scrape horizon in days. The venue's effective horizon is the
    // max over its subscribers (falling back to the category default).
    windowDays: integer('window_days'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.venueId] }),
    venueIdx: index('user_venues_venue_id_idx').on(t.venueId),
  }),
);

// "Want to go" bookmarks for logged-in users.
export const wantToGo = pgTable(
  'want_to_go',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.eventId] }),
    userIdx: index('want_to_go_user_id_idx').on(t.userId),
  }),
);

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
  },
  (t) => ({
    venueIdx: index('scrape_runs_venue_id_idx').on(t.venueId),
    startedIdx: index('scrape_runs_started_at_idx').on(t.startedAt),
  }),
);

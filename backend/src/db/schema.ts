import { pgTable, text, timestamp, jsonb, uuid, index, integer } from 'drizzle-orm/pg-core';
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

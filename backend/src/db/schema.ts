import { pgTable, text, timestamp, integer, jsonb, uuid } from 'drizzle-orm/pg-core';

export const venues = pgTable('venues', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull().unique(),
  city: text('city').notNull(),
  country: text('country').notNull(),
  category: text('category').notNull(),
  language: text('language').notNull().default('en'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id').notNull().references(() => venues.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at'),
  durationMinutes: integer('duration_minutes'),
  director: text('director'),
  cast: jsonb('cast').$type<string[]>().default([]),
  genre: text('genre'),
  priceMin: integer('price_min'),
  priceMax: integer('price_max'),
  link: text('link').notNull(),
  scrapedAt: timestamp('scraped_at').notNull().defaultNow(),
});

export const folders = pgTable('folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  name: text('name').notNull(),
  venueIds: jsonb('venue_ids').$type<string[]>().notNull().default([]),
  filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const scrapeCache = pgTable('scrape_cache', {
  venueId: uuid('venue_id').primaryKey().references(() => venues.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').notNull(),
  scrapedAt: timestamp('scraped_at').notNull().defaultNow(),
});

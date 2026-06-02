import { pgTable, text, timestamp, jsonb, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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

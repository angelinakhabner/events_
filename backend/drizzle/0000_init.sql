CREATE TABLE IF NOT EXISTS "venues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL UNIQUE,
  "city" text NOT NULL,
  "country" text NOT NULL,
  "category" text NOT NULL,
  "language" text NOT NULL DEFAULT 'en',
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" text NOT NULL,
  "name" text NOT NULL,
  "filters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "venue_ids" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "folders_device_id_idx" ON "folders" ("device_id");

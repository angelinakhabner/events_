-- GOI-5: personal film lists (want to watch / seen).
CREATE TABLE IF NOT EXISTS "films" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "status" text NOT NULL DEFAULT 'want',
  "watched_venue" text,
  "comment" text,
  "watched_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "films_user_id_idx" ON "films" ("user_id");
-- One row per title per user, case-insensitively ("Dune" == "dune").
CREATE UNIQUE INDEX IF NOT EXISTS "films_user_title_unique" ON "films" ("user_id", lower("title"));

-- GOI-8: newsletter briefs for logged-in users.
CREATE TABLE IF NOT EXISTS "newsletter_subscriptions" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "frequency" text NOT NULL DEFAULT 'weekly',
  "venue_ids" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "after_hour" integer,
  "before_hour" integer,
  "enabled" boolean NOT NULL DEFAULT true,
  "last_sent_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

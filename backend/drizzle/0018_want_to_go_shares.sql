-- GOI-47: share a "want to go" list read-only, by link.
--
-- One row per user. Revoking deletes the row; sharing again mints a fresh
-- token, so a link that was handed out and then revoked stays dead rather
-- than resurrecting when the owner shares again.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "want_to_go_shares" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "token" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Resolving an incoming link is a token lookup, and it happens on every view
-- of a shared list. UNIQUE already indexes it; named here for clarity only.
CREATE INDEX IF NOT EXISTS "want_to_go_shares_token_idx"
  ON "want_to_go_shares" ("token");

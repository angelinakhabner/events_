-- GOI-83: close the site to the public behind shared invite links.
--
-- A pre-auth gate, deliberately not the beginnings of real auth. The threat
-- model is "keep the work-in-progress out of public view and off search
-- engines", not "protect sensitive data" — so: no accounts, no passwords, no
-- email. One table, one middleware file. When magic-link auth ships, this is
-- deleted rather than migrated.
--
-- token_hash is the PRIMARY KEY and stores the SHA-256 of the token, never the
-- token. The raw value is printed once by scripts/invites.ts and is
-- unrecoverable afterwards, so a dump of this table yields nothing usable.
--
-- revoked_at is checked on every request rather than only at exchange time.
-- Otherwise revoking a link would leave every cookie already minted from it
-- working for the rest of its 90 days, which is the opposite of revocation.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "invites" (
  "token_hash"   text PRIMARY KEY,
  "label"        text NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "expires_at"   timestamptz,
  "revoked_at"   timestamptz,
  "last_used_at" timestamptz,
  "use_count"    integer NOT NULL DEFAULT 0
);

-- The admin script revokes and lists by label.
CREATE INDEX IF NOT EXISTS "invites_label_idx" ON "invites" ("label");

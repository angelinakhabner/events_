-- GOI-35: one-click unsubscribe.
--
-- The brief's footer already said "Unsubscribe", but the link went to
-- /my?tab=newsletter — the same place as "Manage preferences", behind a login.
-- A recipient who no longer has (or never had) access to the account had no way
-- to stop the mail, which is also what List-Unsubscribe requires of a sender.
--
-- Each subscription carries an opaque, per-subscription secret instead of a
-- signed userId, so the link reveals nothing about the account and can be
-- rotated by clearing the column.
ALTER TABLE newsletter_subscriptions
  ADD COLUMN IF NOT EXISTS unsubscribe_token text;

-- Backfill existing rows. gen_random_uuid() is available from pg13 core; two
-- concatenated uuids give ~256 bits, matching the freshly generated tokens.
UPDATE newsletter_subscriptions
   SET unsubscribe_token = replace(gen_random_uuid()::text, '-', '')
                        || replace(gen_random_uuid()::text, '-', '')
 WHERE unsubscribe_token IS NULL;

ALTER TABLE newsletter_subscriptions
  ALTER COLUMN unsubscribe_token SET NOT NULL;

-- Lookup is by token alone (the request carries no session), so it must be
-- both indexed and unique.
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscriptions_unsubscribe_token_idx
  ON newsletter_subscriptions (unsubscribe_token);

-- GOI-126: a reader may hold several newsletters — "a daily one and a weekly
-- one" is the case asked for — rather than one per folder.
--
-- 0026 enforced one config per (user, folder) and one folderless config per
-- user with two partial unique indexes. Each config is addressed by its own id
-- now, so both go. The oldest folderless config stays the reader's default:
-- the one the public API and any caller that names no id reads and writes.
--
-- Idempotent: migrate.ts re-runs every file on every deploy.

DROP INDEX IF EXISTS "newsletter_subscriptions_user_folder_key";
DROP INDEX IF EXISTS "newsletter_subscriptions_user_no_folder_key";

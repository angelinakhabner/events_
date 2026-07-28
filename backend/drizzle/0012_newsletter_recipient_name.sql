-- The brief greets the reader by name ("Hi Ania, today in Warsaw"). Accounts
-- only ever stored an email, so the name is asked for in the newsletter form
-- and kept alongside the rest of the subscription. Optional: blank falls back
-- to a greeting with no name rather than guessing one from the address.
-- Idempotent: safe to re-run.

ALTER TABLE "newsletter_subscriptions" ADD COLUMN IF NOT EXISTS
  "recipient_name" text;

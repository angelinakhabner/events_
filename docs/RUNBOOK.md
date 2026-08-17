# Runbook — when things break

Operational playbook for AFISZ. Ordered roughly by how often each thing bites.

> **Scope note:** the scraper/AI pipeline is **scaffolded but not yet wired**
> (no `scrape_runs` table, no scheduled scrape, events are mock data). Sections
> marked _(planned)_ describe the target design and the commands that *will*
> apply once the pipeline lands; they don't fully work today. Everything else is
> live.

## Scraper returns 0 events _(planned pipeline)_

When a venue scrape produces nothing:

1. **Check the `scrape_runs` row** for that venue: read `status` and
   `error_message`. `error` ⇒ fetch/parse threw; `success` with
   `events_found = 0` ⇒ Claude returned nothing usable.
2. **Did the site HTML change?** Venues redesign pages constantly. Fetch the URL
   and compare structure to what the preprocessor expects. A layout change is
   the most common cause of a sudden drop to 0.
3. **Inspect Claude's raw output locally:**
   ```bash
   npm --workspace backend run scrape:one -- <venueUrl> --debug
   ```
   `--debug` should dump the trimmed HTML sent to Claude and the raw JSON Claude
   returned, so you can see whether Claude misread the page or the validator
   rejected everything.
4. If Claude's output is fine but nothing persisted, it's a **validator**
   problem — check the zod errors logged per dropped entry.

> Today: `scraper.ts` only fetches HTML and `ai-parser.ts` throws if *any* entry
> is invalid (no per-entry degradation), and there is no `scrape:one` script or
> `scrape_runs` table yet. Build those as part of the scrape milestone.

## Newsletter isn't arriving

Briefs are sent by an in-process sweep that ticks every minute
(`services/newsletter.ts`), not by an external cron — each subscription picks
its own send time down to the minute. Work down this list; the first item is
the usual answer.

1. **Is the sweep even running?** It only starts when **`NEWSLETTER_CRON_ENABLED=true`
   *and* `DATABASE_URL`** are set. With the flag unset the backend logs
   `[newsletter] disabled (set NEWSLETTER_CRON_ENABLED=true to enable)` at boot
   and no brief is ever mailed, no matter what users configured on `/my`. Set it
   in Railway → Variables and redeploy.
2. **Ask the backend.** With `ADMIN_TOKEN` set:
   ```bash
   curl "https://<backend>/admin/newsletter?token=$ADMIN_TOKEN"
   ```
   Returns `config` (which of the three requirements are satisfied, plus a
   `problems` list) and a **dry run** of the sweep: one entry per enabled
   subscription with `status`, `reason`, `dueAt` and how many events its filters
   matched. Nothing is sent or recorded.
3. **Read the reason.**
   - `not-due` — its send time hasn't come round yet (or its slot is already
     sent). `dueAt` shows the slot being compared against `lastSentAt`.
   - `no-venues` — the subscriber follows no venues, so there is nothing to
     brief on. An empty venue selection means "all *my* venues", never "all
     venues in the database".
   - `no-events` — filters matched nothing in the window. Usually an empty
     events table (is `SCRAPE_CRON_ENABLED` on?) or a narrow after/before-hour
     window. Empty briefs are deliberately not mailed.
   - `send-failed` — `detail` carries Resend's own message; see 5.
4. **Send one now** rather than waiting for the next tick:
   ```bash
   curl "https://<backend>/admin/newsletter/send?token=$ADMIN_TOKEN&user=<email>&force=1"
   ```
   `force=1` bypasses the schedule; empty briefs are still skipped.
5. **Isolate Resend** from brief-selection problems with a fixed test email:
   ```bash
   curl "https://<backend>/admin/email-test?to=you@example.com&token=$ADMIN_TOKEN"
   ```
   A failure here is a mail-config problem, not a newsletter one — see
   [Sign-in emails arrive for the owner but not for anyone else](#sign-in-emails-arrive-for-the-owner-but-not-for-anyone-else),
   which covers the same unverified-domain cause.

A missed slot (deploy, restart) is picked up by the next tick and by the sweep
that runs a minute after boot, as long as it's within `CATCH_UP_HOURS` (6h) of
the send time. Past that the brief is stale and waits for the next slot.

## Railway deploy fails

Check **Railway → service → Deployments → build/deploy logs** first. Common
causes:

- **Workspace install issues.** This is a monorepo; the build must install from
  the **root** and build the backend workspace
  (`npm --workspace backend run build`). Past failures came from redundant
  `npm ci` steps and `EBUSY` — see git history (`railway.json` is now minimal on
  purpose). Don't add extra install steps to `buildCommand`.
- **Missing env var.** `DATABASE_URL` must be `${{ Postgres.DATABASE_URL }}`.
  Without it the server still boots (in-memory folder store) but folders won't
  persist. `ANTHROPIC_API_KEY`/`RESEND_API_KEY` are lazy — absence only breaks
  those features.
- **Migration failure on boot.** `start` runs `db:migrate` before the server. A
  bad migration crashes the boot and the healthcheck (`/health`) never goes
  green → deploy marked failed. See [DB migration fails](#db-migration-fails-on-railway).
- **Health probe.** The server binds `0.0.0.0` (Railway requirement). If you see
  the probe time out, confirm the bind and that `PORT` is read from the env.

## CI fails on a PR

CI (`.github/workflows/ci.yml`) runs: install → migrate (CI Postgres) →
typecheck → lint → `npm test`. Typical causes, in order:

- **Type errors** — run `npm run typecheck` locally; shared-type changes often
  break both packages.
- **Lint** — `npm run lint` (ESLint, flat config).
- **Test failures** — `npm test` runs backend + frontend Vitest. Integration
  tests need Postgres; locally run `docker compose up -d` first (CI provides a
  `postgres:16` service + `DATABASE_URL`).
- **Migration step red** — a malformed `backend/drizzle/*.sql` fails before
  tests even run.

## Sign-in emails arrive for the owner but not for anyone else

The classic symptom when adding a tester: you can log in, they ask for a link
and nothing ever shows up (not even in spam). The app is fine — Resend is
refusing the send.

Resend only accepts arbitrary recipients once the **sending domain is
verified**. Until then it delivers solely to the Resend account's own address
and rejects everyone else with *"you can only send testing emails to your own
email address"*. There is no per-recipient allowlist to add someone to — the
account owner's address works by default and that's the whole exception.

**Confirm it in one call** (needs `ADMIN_TOKEN` set on the backend):

```
GET https://<backend>/admin/email-test?to=<their-address>&token=<ADMIN_TOKEN>
```

It sends one real email and returns Resend's verbatim answer, plus the
`from` address actually in use. `{"ok": true}` means the address is
deliverable and the problem is elsewhere (spam filter, typo). An error
naming the account's own address confirms the unverified-domain case.

**The fix** — verify a domain you control in Resend:

1. Resend → **Domains** → **Add Domain**, enter the domain (e.g. `goin.app`).
2. Add the DKIM/SPF DNS records Resend shows to that domain's DNS, then hit
   **Verify**. Propagation is usually minutes.
3. Set `RESEND_FROM_EMAIL` on Railway to an address on the verified domain
   (`hello@afisz.cc`) and redeploy. Optionally set `NEWSLETTER_FROM_EMAIL`
   (e.g. `newsletter@afisz.cc`) to send briefs from a second address on the
   same domain — check it with `&sender=newsletter` on the call below.
4. Re-run the `/admin/email-test` call above for the tester's address.

Notes:

- `onboarding@resend.dev` is Resend's built-in sender and is **permanently**
  limited to your own account address — it can't be made to reach a tester.
- Verification is per **domain**, not per recipient: once it passes, every
  address works, and no code change is needed to add a person.
- A feed inbox like `…@feed.readwise.io` can receive newsletter briefs, but
  nobody can click a magic link from it — it's not a sign-in address.

## Claude API errors _(AI parsing)_

`services/ai-parser.ts` calls the Anthropic messages API. Failure modes:

- **Rate limit (HTTP 429):** back off and retry; if it's a scheduled scrape,
  let the next run pick it up. Don't hammer.
- **Invalid / unparseable response:** Claude returned non-JSON or a shape that
  fails the `ParsedEvent` zod schema. Check `extractJson` (handles ```json
  fences) and the validator logs. Usually a prompt or page-content issue — view
  the raw text Claude returned before blaming the validator.
- **Expired / invalid key (HTTP 401):** verify `ANTHROPIC_API_KEY` in the
  Anthropic console and in Railway env. The client is constructed lazily, so a
  bad key only errors on the first AI call, not at boot.
- **Model:** `ai-parser.ts` pins the model in one place (`messages.create`).
  Bump it there if a model is retired.

## DB migration fails on Railway

Migrations are plain SQL in `backend/drizzle/`, applied in filename order by
`db/migrate.ts`.

- **Run manually** against the Railway DB:
  ```bash
  DATABASE_URL='<railway-postgres-url>' npm --workspace backend run db:migrate
  ```
  (Get the URL from the Postgres plugin's Connect tab.)
- **Reset (dev/staging only — destructive):**
  ```bash
  DATABASE_URL='<url>' npm --workspace backend run db:reset
  ```
  `db:reset` drops `folders`/`venues` then re-applies all migrations.
- **Rollback:** there is no down-migration system. To roll back, write a new
  forward migration that reverses the change (or, in dev, `db:reset`). Never
  hand-edit an already-applied migration file — add a new numbered one.
- Migrations are idempotent-ish (`CREATE TABLE IF NOT EXISTS`), but a failing
  statement aborts the run; fix the SQL and re-run.

## Pages site shows the README instead of the app

GitHub Pages is showing repo content, not the built SPA. Debug:

1. **Settings → Pages → Source** must be **GitHub Actions** (not "Deploy from a
   branch"). If it's set to a branch, Pages serves `README.md` — switch it.
2. **Check the `Deploy frontend` workflow run** (Actions tab). It only runs
   after `CI` succeeds on `main`, or via manual `workflow_dispatch`. If CI is
   red, the deploy never fires and Pages keeps the last (or default) content.
3. **Blank page / 404 on assets** instead of README usually means a wrong
   `base` path — confirm the workflow passed `VITE_BASE_PATH=/` (the site is
   served from the `afisz.cc` apex, not the `/<repo>/` subpath) and that
   `VITE_API_URL` (Actions repo variable) points at `https://api.afisz.cc`.
4. Re-run from **Actions → Deploy frontend → Run workflow** after fixing.

## Site loads but no events appear

The page renders, the header is there, the feed is empty. The frontend is
fine; something between it and `https://api.afisz.cc/trpc` is not. Check the
API host before touching anything in the app:

```bash
getent hosts api.afisz.cc     # NXDOMAIN ⇒ the DNS record is missing
curl https://api.afisz.cc/health
```

`ERR_NAME_NOT_RESOLVED` on the `/trpc` request in DevTools means the `api`
subdomain was never created at the DNS host, or was created in the wrong zone
— registering the custom domain in Railway does *not* create it. Full
walkthrough, including the Railway and Google-console settings that move with
the domain, in [`DOMAINS.md`](DOMAINS.md).

If `/health` answers `{"ok":true}` and the feed is still empty, the domain is
not the problem — check `DATABASE_URL` and whether a scrape has ever
succeeded (`events.listDefault` returns `[]` when `DATABASE_URL` is unset).

## Quick reference

| Symptom | First look |
|---|---|
| Folders don't persist | `DATABASE_URL` unset → in-memory store |
| `UNAUTHORIZED` on folder ops | missing/!matching `x-device-id` header |
| AI parse 401 | `ANTHROPIC_API_KEY` invalid/expired |
| Login email reaches you but no one else | Resend sending domain unverified → `/admin/email-test?to=…` |
| Deploy red, health never green | migration crash on boot, or not binding `0.0.0.0` |
| Pages shows README | Pages Source not set to "GitHub Actions" |

# Runbook — when things break

Operational playbook for Goin. Ordered roughly by how often each thing bites.

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
   `base` path — confirm the workflow passed `VITE_BASE_PATH=/<repo>/` and that
   `VITE_API_URL` (Actions repo variable) points at the Railway backend.
4. Re-run from **Actions → Deploy frontend → Run workflow** after fixing.

## Quick reference

| Symptom | First look |
|---|---|
| Folders don't persist | `DATABASE_URL` unset → in-memory store |
| `UNAUTHORIZED` on folder ops | missing/!matching `x-device-id` header |
| AI parse 401 | `ANTHROPIC_API_KEY` invalid/expired |
| Deploy red, health never green | migration crash on boot, or not binding `0.0.0.0` |
| Pages shows README | Pages Source not set to "GitHub Actions" |

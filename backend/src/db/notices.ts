/**
 * Postgres NOTICE handling for the `postgres` clients.
 *
 * Without an `onnotice` handler the driver pretty-prints the whole notice
 * object — seven lines of `severity_local` / `code` / `file` / `line` /
 * `routine` per notice. The migration runner replays every `*.sql` file on
 * each boot, and the idempotent DDL in them (`CREATE TABLE IF NOT EXISTS`,
 * `ADD COLUMN IF NOT EXISTS`, …) makes Postgres emit one notice per statement
 * once the schema is already in place. That is ~290 lines of pure noise per
 * deploy, burst-written in a second or two — enough to trip Railway's log
 * rate limit and start dropping real messages.
 *
 * These "… already exists, skipping" / "… does not exist, skipping" notices
 * are exactly what the `IF [NOT] EXISTS` guards are there to produce, so they
 * carry no information. Drop them. Anything else still gets surfaced, but as
 * a single line rather than a dumped object.
 */

/** SQLSTATEs Postgres raises when idempotent DDL no-ops. */
const IDEMPOTENT_DDL_CODES = new Set([
  '42P06', // duplicate_schema
  '42P07', // duplicate_table (covers indexes too)
  '42701', // duplicate_column
  '42710', // duplicate_object — constraints, types, roles
  '42P01', // undefined_table    — DROP … IF EXISTS
  '42703', // undefined_column   — DROP COLUMN IF EXISTS
  '42704', // undefined_object   — DROP CONSTRAINT/TYPE IF EXISTS
]);

/** Shape of the notice the `postgres` driver hands to `onnotice`. */
export interface PostgresNotice {
  severity?: string;
  code?: string;
  message?: string;
  detail?: string;
}

export function onnotice(notice: PostgresNotice): void {
  if (notice.code && IDEMPOTENT_DDL_CODES.has(notice.code)) return;

  const severity = notice.severity ?? 'NOTICE';
  const message = notice.message ?? '(no message)';
  const line = `[pg] ${severity} ${notice.code ?? '-'}: ${message}`;
  if (severity === 'WARNING' || severity === 'ERROR') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

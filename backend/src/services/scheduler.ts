import { sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { scrapeVenue } from './scraper/runner.js';

const TZ = 'Europe/Warsaw';

/**
 * Backoff schedule (minutes) for re-scraping venues that failed on a
 * transient, credit/rate-limit-style error. After the last pass we give up
 * and wait for the next daily sweep rather than spinning forever — if credits
 * are still at zero, a tight loop just burns logs.
 */
const RETRY_BACKOFFS_MIN = [30, 60, 120];

/**
 * In-process daily scrape scheduler. Replaces an external cron: Railway's
 * cron feature isn't available on every plan, and the backend service is
 * already always-on, so a setTimeout loop inside the server process is the
 * simplest reliable option.
 *
 * Fires at the configured hour (default 07:00) in Europe/Warsaw, then
 * re-arms for the next day. Skips silently when DATABASE_URL is unset.
 *
 * After each sweep, venues that failed on a retryable error (out of credits /
 * rate limited) are re-scraped on a backoff — only those venues, leaving the
 * ones that already succeeded untouched.
 */
export function startScrapeScheduler(opts: { hour?: number } = {}): { stop: () => void } {
  const hour = opts.hour ?? 7;
  let dailyTimer: NodeJS.Timeout | null = null;
  let sleepTimer: NodeJS.Timeout | null = null;
  let wakeSleep: (() => void) | null = null;
  let stopped = false;

  // Interruptible sleep so stop() doesn't leave a multi-hour timer dangling.
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      sleepTimer = setTimeout(() => {
        sleepTimer = null;
        wakeSleep = null;
        resolve();
      }, ms);
      sleepTimer.unref?.();
      wakeSleep = resolve;
    });

  const arm = () => {
    if (stopped) return;
    const delay = msUntilNextWarsawHour(hour);
    console.log(`[scheduler] next scrape in ${(delay / 3_600_000).toFixed(1)}h (daily at ${String(hour).padStart(2, '0')}:00 ${TZ})`);
    dailyTimer = setTimeout(async () => {
      try {
        await scrapeAllVenues();
        await runRetryPasses();
      } catch (e) {
        console.error('[scheduler] scrape sweep failed:', e);
      } finally {
        arm();
      }
    }, delay);
    // Don't keep the process alive just for the scheduler.
    dailyTimer.unref?.();
  };

  /**
   * Re-scrape venues whose latest run failed on a retryable error, backing off
   * between passes. Stops early once nothing retryable remains.
   */
  const runRetryPasses = async () => {
    for (const mins of RETRY_BACKOFFS_MIN) {
      if (stopped) return;
      const pending = await retryableFailedVenues();
      if (pending.length === 0) return;
      console.log(
        `[scheduler] ${pending.length} venue(s) failed on credits/rate-limit; retrying in ${mins}m: ${pending.map((v) => v.name).join(', ')}`,
      );
      await sleep(mins * 60_000);
      if (stopped) return;
      await scrapeVenues(pending);
    }
    const left = await retryableFailedVenues();
    if (left.length) {
      console.warn(
        `[scheduler] ${left.length} venue(s) still failing after ${RETRY_BACKOFFS_MIN.length} retries; waiting for next daily run`,
      );
    }
  };

  arm();
  return {
    stop: () => {
      stopped = true;
      if (dailyTimer) clearTimeout(dailyTimer);
      if (sleepTimer) clearTimeout(sleepTimer);
      // Resolve any in-flight sleep so the retry loop can observe `stopped`.
      wakeSleep?.();
    },
  };
}

export async function scrapeAllVenues(): Promise<void> {
  const db = getDb();
  const venues = await db.select().from(schema.venues);
  console.log(`[scheduler] scraping ${venues.length} venue(s)...`);
  await scrapeVenues(venues);
}

type VenueRow = typeof schema.venues.$inferSelect;

async function scrapeVenues(venues: Pick<VenueRow, 'id' | 'name'>[]): Promise<void> {
  for (const v of venues) {
    try {
      const run = await scrapeVenue(v.id);
      console.log(`[scheduler] ${v.name}: ${run.status} (${run.eventsFound ?? '-'} events)`);
    } catch (e) {
      console.error(`[scheduler] ${v.name} threw:`, e instanceof Error ? e.message : e);
    }
  }
}

/**
 * Venues whose most-recent scrape run failed on a retryable error. This is the
 * "what didn't refresh" set: a credit outage leaves a block of failed runs and
 * the previously-scraped events untouched, so re-running just these venues
 * resumes the sweep without re-billing the ones that already succeeded.
 *
 * Reads from the DB rather than in-memory state so it stays correct even after
 * a process restart.
 */
export async function retryableFailedVenues(): Promise<Pick<VenueRow, 'id' | 'name'>[]> {
  const db = getDb();
  // Latest run per venue via DISTINCT ON (venue_id) ordered by started_at desc.
  const latest = await db.execute(sql`
    SELECT DISTINCT ON (sr.venue_id) sr.venue_id, sr.status, sr.error_message, v.name
    FROM scrape_runs sr
    JOIN venues v ON v.id = sr.venue_id
    ORDER BY sr.venue_id, sr.started_at DESC
  `);
  const rows = unwrapRows<{ venue_id: string; status: string; error_message: string | null; name: string }>(latest);
  return rows
    .filter((r) => r.status === 'failed' && isRetryableScrapeError(r.error_message))
    .map((r) => ({ id: r.venue_id, name: r.name }));
}

/**
 * Whether a failed run's error message looks like a transient, capacity/billing
 * problem worth retrying — as opposed to a real bug (changed HTML, bad parse)
 * that retrying every 30 minutes would only paper over.
 *
 * Matches the shapes the Anthropic SDK surfaces: a leading HTTP status plus the
 * JSON error body. Out-of-credits is a 400 but its message is distinctive.
 */
export function isRetryableScrapeError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('credit balance') || // out of credits (HTTP 400, but retryable once topped up)
    m.includes('rate limit') ||
    m.includes('rate_limit') ||
    m.includes('overloaded') ||
    /\b429\b/.test(m) || // too many requests
    /\b529\b/.test(m) // overloaded
  );
}

function unwrapRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const r = (result as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as T[];
  }
  return [];
}

/** Milliseconds until the next occurrence of HH:00 in Europe/Warsaw. */
export function msUntilNextWarsawHour(hour: number, now: Date = new Date()): number {
  // Read the current Warsaw wall-clock via Intl, then walk forward in
  // 1-minute steps is wasteful — instead compute today's target in Warsaw
  // and convert: find the UTC timestamp whose Warsaw rendering is HH:00.
  // Simpler approach: iterate candidate UTC times (today/tomorrow at
  // hour-2 .. hour+2 UTC handles both CET and CEST offsets).
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  for (let addDays = 0; addDays <= 2; addDays++) {
    for (let utcHour = hour - 3; utcHour <= hour + 1; utcHour++) {
      const candidate = new Date(now);
      candidate.setUTCDate(candidate.getUTCDate() + addDays);
      candidate.setUTCHours(utcHour, 0, 0, 0);
      if (candidate.getTime() <= now.getTime()) continue;
      const parts = fmt.format(candidate); // e.g. "2026-06-12, 07:00"
      if (parts.endsWith(`${String(hour).padStart(2, '0')}:00`)) {
        return candidate.getTime() - now.getTime();
      }
    }
  }
  // Fallback: 24h from now (should be unreachable).
  return 24 * 3_600_000;
}

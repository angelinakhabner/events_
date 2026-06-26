import { sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { scrapeVenue } from './scraper/runner.js';

const TZ = 'Europe/Warsaw';

/** Short weekday names as rendered by Intl in Europe/Warsaw, mapped to the
 *  JS `getDay()` convention (0=Sunday … 6=Saturday). */
const WEEKDAY_NUM: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};
const WEEKDAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Backoff schedule (minutes) for re-scraping venues that failed on a
 * transient, credit/rate-limit-style error. After the last pass we give up
 * and wait for the next scheduled sweep rather than spinning forever — if
 * credits are still at zero, a tight loop just burns logs.
 */
const RETRY_BACKOFFS_MIN = [30, 60, 120];

/**
 * In-process scrape scheduler. Replaces an external cron: Railway's cron
 * feature isn't available on every plan, and the backend service is already
 * always-on, so a setTimeout loop inside the server process is the simplest
 * reliable option.
 *
 * Fires at the configured hour (default 07:00) in Europe/Warsaw, then re-arms.
 * Cadence depends on `dayOfWeek`:
 *   - undefined → daily (the original behaviour).
 *   - 0–6 (Sun–Sat) → weekly, only on that weekday. Most venues publish
 *     schedules weeks/months out, so a daily sweep mostly re-bills tokens for
 *     unchanged listings; weekly cuts that cost ~7×.
 * Skips silently when DATABASE_URL is unset.
 *
 * After each sweep, venues that failed on a retryable error (out of credits /
 * rate limited) are re-scraped on a backoff — only those venues, leaving the
 * ones that already succeeded untouched.
 */
export function startScrapeScheduler(opts: { hour?: number; dayOfWeek?: number } = {}): { stop: () => void } {
  const hour = opts.hour ?? 7;
  const dayOfWeek = opts.dayOfWeek;
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
    const delay = msUntilNextWarsawTime(hour, dayOfWeek);
    const cadence = dayOfWeek === undefined ? 'daily' : `weekly on ${WEEKDAY_NAME[dayOfWeek]}`;
    console.log(`[scheduler] next scrape in ${(delay / 3_600_000).toFixed(1)}h (${cadence} at ${String(hour).padStart(2, '0')}:00 ${TZ})`);
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
        `[scheduler] ${left.length} venue(s) still failing after ${RETRY_BACKOFFS_MIN.length} retries; waiting for next scheduled run`,
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

// Anthropic org cap is 30k input tokens / minute. A single venue's prompt can
// be 30-80k tokens, so even one request can consume the bucket. The SDK
// already retries 429s with backoff, but a pause between venues makes the
// retries shorter (we wait off-the-clock instead of inside a backoff loop).
// Tunable via SCRAPE_VENUE_GAP_MS env if you need to push through faster.
const DEFAULT_VENUE_GAP_MS = 65_000;

/** Read SCRAPE_VENUE_GAP_MS fresh each sweep so Railway variable edits take
 *  effect on the next cron tick without a redeploy. Empty/invalid → default;
 *  explicit `0` disables the gap (back-to-back, accept the 429 risk). */
export function readVenueGapMs(): number {
  const raw = process.env.SCRAPE_VENUE_GAP_MS;
  if (raw === undefined || raw === '') return DEFAULT_VENUE_GAP_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_VENUE_GAP_MS;
  return n;
}

export async function scrapeAllVenues(): Promise<void> {
  const db = getDb();
  const venues = await db.select().from(schema.venues);
  console.log(`[scheduler] scraping ${venues.length} venue(s)...`);
  await scrapeVenues(venues);
}

type VenueRow = typeof schema.venues.$inferSelect;

async function scrapeVenues(venues: Pick<VenueRow, 'id' | 'name'>[]): Promise<void> {
  const gapMs = readVenueGapMs();
  console.log(`[scheduler] gap ${gapMs}ms between venues`);
  for (let i = 0; i < venues.length; i++) {
    const v = venues[i]!;
    try {
      const run = await scrapeVenue(v.id);
      console.log(`[scheduler] ${v.name}: ${run.status} (${run.eventsFound ?? '-'} events)`);
    } catch (e) {
      // scrapeVenue swallows its own errors and returns status='failed', so
      // this catches only unexpected throws from the runner's finalize path.
      console.error(`[scheduler] ${v.name} threw:`, e instanceof Error ? e.message : e);
    }
    if (i < venues.length - 1 && gapMs > 0) {
      await new Promise((r) => setTimeout(r, gapMs));
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

/**
 * Milliseconds until the next HH:00 in Europe/Warsaw, optionally pinned to a
 * weekday (`dayOfWeek` 0=Sunday … 6=Saturday).
 *
 * We can't just add 24h/7d to a UTC timestamp because of DST — the target is a
 * Warsaw wall-clock time. Instead we probe candidate UTC instants and ask Intl
 * how each renders in Warsaw, keeping the first whose hour (and weekday, when
 * required) matches. Scanning hour-3 .. hour+1 UTC covers both CET and CEST
 * offsets; addDays up to 8 guarantees a weekday match within a week.
 */
export function msUntilNextWarsawTime(hour: number, dayOfWeek?: number, now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const maxDays = dayOfWeek === undefined ? 2 : 8;
  const targetHour = String(hour).padStart(2, '0');
  for (let addDays = 0; addDays <= maxDays; addDays++) {
    for (let utcHour = hour - 3; utcHour <= hour + 1; utcHour++) {
      const candidate = new Date(now);
      candidate.setUTCDate(candidate.getUTCDate() + addDays);
      candidate.setUTCHours(utcHour, 0, 0, 0);
      if (candidate.getTime() <= now.getTime()) continue;
      const parts = fmt.formatToParts(candidate);
      const h = parts.find((p) => p.type === 'hour')?.value;
      const min = parts.find((p) => p.type === 'minute')?.value;
      const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
      if (h !== targetHour || min !== '00') continue;
      if (dayOfWeek !== undefined && WEEKDAY_NUM[wd] !== dayOfWeek) continue;
      return candidate.getTime() - now.getTime();
    }
  }
  // Fallback (should be unreachable): one cadence period from now.
  return (dayOfWeek === undefined ? 24 : 7 * 24) * 3_600_000;
}

/** Milliseconds until the next occurrence of HH:00 in Europe/Warsaw (daily). */
export function msUntilNextWarsawHour(hour: number, now: Date = new Date()): number {
  return msUntilNextWarsawTime(hour, undefined, now);
}

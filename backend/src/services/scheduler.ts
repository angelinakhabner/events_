import { getDb, schema } from '../db/index.js';
import { scrapeVenue } from './scraper/runner.js';

const TZ = 'Europe/Warsaw';

/**
 * In-process daily scrape scheduler. Replaces an external cron: Railway's
 * cron feature isn't available on every plan, and the backend service is
 * already always-on, so a setTimeout loop inside the server process is the
 * simplest reliable option.
 *
 * Fires at the configured hour (default 07:00) in Europe/Warsaw, then
 * re-arms for the next day. Skips silently when DATABASE_URL is unset.
 */
export function startScrapeScheduler(opts: { hour?: number } = {}): { stop: () => void } {
  const hour = opts.hour ?? 7;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const arm = () => {
    if (stopped) return;
    const delay = msUntilNextWarsawHour(hour);
    console.log(`[scheduler] next scrape in ${(delay / 3_600_000).toFixed(1)}h (daily at ${String(hour).padStart(2, '0')}:00 ${TZ})`);
    timer = setTimeout(async () => {
      try {
        await scrapeAllVenues();
      } catch (e) {
        console.error('[scheduler] scrape sweep failed:', e);
      } finally {
        arm();
      }
    }, delay);
    // Don't keep the process alive just for the scheduler.
    timer.unref?.();
  };

  arm();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export async function scrapeAllVenues(): Promise<void> {
  const db = getDb();
  const venues = await db.select().from(schema.venues);
  console.log(`[scheduler] scraping ${venues.length} venue(s)...`);
  for (const v of venues) {
    try {
      const run = await scrapeVenue(v.id);
      console.log(`[scheduler] ${v.name}: ${run.status} (${run.eventsFound ?? '-'} events)`);
    } catch (e) {
      console.error(`[scheduler] ${v.name} threw:`, e instanceof Error ? e.message : e);
    }
  }
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

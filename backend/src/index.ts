import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { env } from './config.js';
import { startScrapeScheduler } from './services/scheduler.js';

const app = createApp();

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`Goin backend listening on http://${info.address}:${info.port}`);
});

// Scheduled scrape runs inside the server process (Railway cron isn't
// available on all plans). Enabled explicitly so dev/test servers don't scrape.
// Cadence is daily unless SCRAPE_CRON_DAY_OF_WEEK pins it to a weekday.
if (env.SCRAPE_CRON_ENABLED && env.DATABASE_URL) {
  startScrapeScheduler({ hour: env.SCRAPE_CRON_HOUR, dayOfWeek: env.SCRAPE_CRON_DAY_OF_WEEK });
} else {
  console.log('[scheduler] disabled (set SCRAPE_CRON_ENABLED=true to enable)');
}

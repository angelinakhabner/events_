import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { env } from './config.js';
import { startScrapeScheduler } from './services/scheduler.js';
import { startNewsletterScheduler } from './services/newsletter.js';

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

// Newsletter briefs go out on their own hourly tick — each subscription picks
// the hour (and weekday) it wants, and the sweep sends the ones due. Needs the
// DB (events + subscriptions) and a Resend key to actually deliver anything.
// Silence here is indistinguishable from "no one is subscribed", so name the
// missing piece rather than printing one generic line for both causes.
if (env.NEWSLETTER_CRON_ENABLED && env.DATABASE_URL) {
  startNewsletterScheduler();
} else {
  const missing = [
    env.NEWSLETTER_CRON_ENABLED ? null : 'NEWSLETTER_CRON_ENABLED=true',
    env.DATABASE_URL ? null : 'DATABASE_URL',
  ].filter(Boolean).join(' and ');
  console.log(`[newsletter] disabled — no briefs will be sent (needs ${missing}). See docs/RUNBOOK.md`);
}

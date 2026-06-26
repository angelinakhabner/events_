import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // When set, the scraper renders venue *listing* pages through Firecrawl
  // (JS execution + anti-bot) instead of a plain fetch, falling back to native
  // fetch on any Firecrawl error. Absent → native fetch only (today's behaviour).
  // Enrichment (per-event detail pages) always stays on native fetch — cost.
  FIRECRAWL_API_KEY: z.string().optional(),
  FIRECRAWL_API_URL: z.string().default('https://api.firecrawl.dev'),
  // Milliseconds Firecrawl waits for client-side JS to finish rendering before
  // capturing the page. JS-heavy listings (MSN, Nowy Teatr) can render an empty
  // shell if captured too early. 0 disables the wait.
  FIRECRAWL_WAIT_MS: z.coerce.number().int().min(0).default(5000),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default('hello@goin.app'),
  // When set, enables the /admin/* debug endpoints (manual scrape trigger,
  // venue list). Callers must pass ?token=<this>. Unset → endpoints disabled.
  ADMIN_TOKEN: z.string().optional(),
  SCRAPE_CRON_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  SCRAPE_CRON_HOUR: z.coerce.number().int().min(0).max(23).default(7),
  // Day of week to run the scrape on, in Europe/Warsaw (0=Sunday … 6=Saturday).
  // Unset → daily. Set to e.g. 1 (Monday) for a weekly sweep: most venues
  // publish weeks/months ahead, so daily mostly re-bills tokens for unchanged
  // listings — weekly cuts that cost roughly 7×.
  SCRAPE_CRON_DAY_OF_WEEK: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v),
    z.coerce.number().int().min(0).max(6).optional(),
  ),
});

export const env = Env.parse(process.env);
export type Env = z.infer<typeof Env>;

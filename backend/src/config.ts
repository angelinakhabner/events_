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
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default('hello@goin.app'),
  SCRAPE_CRON_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  SCRAPE_CRON_HOUR: z.coerce.number().int().min(0).max(23).default(7),
});

export const env = Env.parse(process.env);
export type Env = z.infer<typeof Env>;

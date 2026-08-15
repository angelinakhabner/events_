import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Extraction model. Overridable so a cheaper model can be trialled without a
  // deploy; see EXTRACTOR_MODEL_STRUCTURED and the note in extractor.ts.
  EXTRACTOR_MODEL: z.string().default('claude-sonnet-4-6'),
  // GOI-16: model used only for pages whose input is structured data (JSON-LD
  // or __NEXT_DATA__) rather than HTML — transcription, not interpretation.
  // Unset → EXTRACTOR_MODEL, i.e. no behaviour change.
  EXTRACTOR_MODEL_STRUCTURED: z.string().optional(),
  // When set, the scraper renders venue *listing* pages through Firecrawl
  // (JS execution + anti-bot) instead of a plain fetch, falling back to native
  // fetch on any Firecrawl error. Absent → native fetch only (today's behaviour).
  // Enrichment (per-event detail pages) always stays on native fetch — cost.
  /** Per-run ceiling on detail-page fetches during description enrichment
   *  (GOI-79). Each one is an HTTP request plus a model call. */
  MAX_DETAIL_FETCHES: z.coerce.number().int().min(0).default(50),
  FIRECRAWL_API_KEY: z.string().optional(),
  FIRECRAWL_API_URL: z.string().default('https://api.firecrawl.dev'),
  // Milliseconds Firecrawl waits for client-side JS to finish rendering before
  // capturing the page. JS-heavy listings (MSN, Nowy Teatr) can render an empty
  // shell if captured too early. 0 disables the wait.
  FIRECRAWL_WAIT_MS: z.coerce.number().int().min(0).default(5000),
  // Public origin of the frontend — magic-link login emails point here.
  APP_URL: z.string().default('http://localhost:5173'),
  // "Sign in with Google" (OAuth 2.0 / OIDC, free). All three must be set to
  // enable it: a client id/secret from Google Cloud Console (OAuth consent
  // screen + Web application credentials, no cost) and this backend's public
  // origin (e.g. the Railway URL) used to build the redirect URI
  // <API_PUBLIC_URL>/auth/google/callback — register exactly that URI in the
  // Google console. Unset → the Google button simply doesn't render.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  API_PUBLIC_URL: z.string().optional(),
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
  // Newsletter briefs (GOI-8). The tick is hourly; each subscription picks its
  // own send hour and (for weekly briefs) weekday — see GOI-28.
  NEWSLETTER_CRON_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export const env = Env.parse(process.env);
export type Env = z.infer<typeof Env>;

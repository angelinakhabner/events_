import { env } from '../../config.js';

/**
 * The paid tier (GOI-72 §4), behind one interface with one method.
 *
 * Firecrawl is a vendor, not an architecture. Keeping the surface this small
 * means swapping it costs one file, and — more useful day to day — a test can
 * assert *exactly* how many times it was called, which is the assertion that
 * stops this from quietly running up a bill.
 */

export interface PaidFetchResult {
  /** Rendered page as markdown, for the same extractor the free path uses. */
  markdown: string;
  /** Credits this call consumed, for cost accounting. */
  credits: number;
}

export interface PaidFetcher {
  fetchRendered(url: string, opts?: { timeoutMs?: number }): Promise<PaidFetchResult>;
}

/** What one rendered page costs. Kept next to the fetcher so a price change is
 *  one edit; `scrape_runs.firecrawl_credits` sums the units, not the money. */
export const FIRECRAWL_CREDITS_PER_PAGE = 1;
/** Rendering is slow — a real browser has to load and settle (GOI-72 §4.5). */
export const PAID_FETCH_TIMEOUT_MS = 45_000;

export class FirecrawlPaidFetcher implements PaidFetcher {
  constructor(
    private readonly apiKey: string,
    private readonly apiUrl: string = env.FIRECRAWL_API_URL,
    private readonly impl: typeof fetch = fetch,
  ) {}

  async fetchRendered(url: string, opts: { timeoutMs?: number } = {}): Promise<PaidFetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? PAID_FETCH_TIMEOUT_MS);
    try {
      const res = await this.impl(`${this.apiUrl.replace(/\/$/, '')}/v1/scrape`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
          waitFor: env.FIRECRAWL_WAIT_MS,
        }),
      });
      if (!res.ok) throw new Error(`Firecrawl responded ${res.status}`);

      const json = (await res.json()) as { data?: { markdown?: unknown } };
      const markdown = json.data?.markdown;
      if (typeof markdown !== 'string' || !markdown.trim()) {
        throw new Error('Firecrawl returned no markdown');
      }
      return { markdown, credits: FIRECRAWL_CREDITS_PER_PAGE };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Null when the deployment has no Firecrawl key — the paid path then reports
 *  PAID_QUOTA_EXCEEDED rather than pretending to be available. */
export function defaultPaidFetcher(): PaidFetcher | null {
  return env.FIRECRAWL_API_KEY ? new FirecrawlPaidFetcher(env.FIRECRAWL_API_KEY) : null;
}

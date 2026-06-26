import { parseKinotekaListing, scrapeKinoteka } from './venues/kinoteka.js';

/**
 * A venue whose listing is structured enough to parse deterministically with
 * cheerio — no LLM call. Cheaper, faster and exact where the source carries
 * machine-readable date/time (e.g. Kinoteka's per-screening data-attributes).
 *
 * `parse` handles a single pre-fetched HTML (tests / admin htmlOverride);
 * `scrape` does its own (possibly multi-page) fetching and returns the raw
 * material to hash for the runner's skip-unchanged check.
 */
export interface DeterministicScraper {
  parse(html: string, timezone: string): unknown[];
  scrape(args: {
    baseUrl: string;
    today: Date;
    windowDays: number;
    timezone?: string;
    fetcher?: typeof fetch;
  }): Promise<{ events: unknown[]; signature: string }>;
}

export const DETERMINISTIC_SCRAPERS: Record<string, DeterministicScraper> = {
  kinoteka: {
    parse: (html, timezone) => parseKinotekaListing(html, timezone),
    scrape: (args) => scrapeKinoteka(args),
  },
};

export function getDeterministicScraper(venueId: string): DeterministicScraper | undefined {
  return DETERMINISTIC_SCRAPERS[venueId];
}

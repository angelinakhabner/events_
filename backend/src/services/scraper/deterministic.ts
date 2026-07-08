import { parseKinotekaListing, scrapeKinoteka } from './venues/kinoteka.js';
import { parseKomediowyListing, scrapeKomediowy } from './venues/komediowy.js';

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
  /**
   * Run the runner's description-enrichment pass over this venue's events.
   * For listings that carry descriptions inline (Kinoteka) it stays off; for
   * ones whose descriptions live on per-event pages (Komediowy) it's the only
   * way rows get a description at all.
   */
  enrich?: boolean;
}

export const DETERMINISTIC_SCRAPERS: Record<string, DeterministicScraper> = {
  kinoteka: {
    parse: (html, timezone) => parseKinotekaListing(html, timezone),
    scrape: (args) => scrapeKinoteka(args),
  },
  'klub-komediowy': {
    parse: (html, timezone) => parseKomediowyListing(html, timezone),
    scrape: (args) => scrapeKomediowy(args),
    enrich: true,
  },
};

export function getDeterministicScraper(venueId: string): DeterministicScraper | undefined {
  return DETERMINISTIC_SCRAPERS[venueId];
}

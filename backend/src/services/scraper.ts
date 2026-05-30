export interface ScrapeResult {
  url: string;
  html: string;
  fetchedAt: string;
}

export interface Fetcher {
  (url: string): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

const defaultFetcher: Fetcher = (url) => fetch(url, {
  headers: { 'User-Agent': 'GoinBot/0.1 (+https://goin.app)' },
});

export async function scrapeVenue(url: string, fetcher: Fetcher = defaultFetcher): Promise<ScrapeResult> {
  const res = await fetcher(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const html = await res.text();
  return { url, html, fetchedAt: new Date().toISOString() };
}

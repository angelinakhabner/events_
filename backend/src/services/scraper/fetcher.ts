export interface FetchOptions {
  timeoutMs?: number;
  acceptLanguage?: string;
  fetcher?: typeof fetch;
}

const USER_AGENT = 'Goin scraper / contact: hello@goin.app';

export async function fetchVenueHTML(url: string, opts: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 15_000, acceptLanguage = 'pl,en;q=0.8', fetcher = fetch } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': acceptLanguage,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

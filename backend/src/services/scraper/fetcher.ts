export interface FetchOptions {
  timeoutMs?: number;
  acceptLanguage?: string;
  fetcher?: typeof fetch;
}

// A browser-like User-Agent. Many venue sites sit behind a WAF (Cloudflare
// etc.) that 403s obvious bot agents, which previously turned a scrapable page
// into a failed run. We still announce contact details via the `From` header
// for politeness/abuse-reporting without tripping UA-based blocks.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CONTACT = 'hello@goin.app';

export async function fetchVenueHTML(url: string, opts: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 15_000, acceptLanguage = 'pl,en;q=0.8', fetcher = fetch } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, {
      headers: {
        'User-Agent': USER_AGENT,
        From: CONTACT,
        'Accept-Language': acceptLanguage,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

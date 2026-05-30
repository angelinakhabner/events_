import { describe, it, expect } from 'vitest';
import { scrapeVenue } from './scraper.js';

describe('scrapeVenue', () => {
  it('returns html on success', async () => {
    const fetcher = async () => ({ ok: true, status: 200, text: async () => '<html>ok</html>' });
    const res = await scrapeVenue('https://example.com', fetcher);
    expect(res.html).toBe('<html>ok</html>');
    expect(res.url).toBe('https://example.com');
  });

  it('throws on non-ok status', async () => {
    const fetcher = async () => ({ ok: false, status: 500, text: async () => '' });
    await expect(scrapeVenue('https://example.com', fetcher)).rejects.toThrow(/HTTP 500/);
  });
});

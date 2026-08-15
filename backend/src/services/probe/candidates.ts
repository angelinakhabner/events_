import * as cheerio from 'cheerio';
import type { ProbeFetcher } from './fetch.js';

/**
 * What the user pastes is almost always a homepage, not a listing (GOI-72 §2).
 * This builds the short list of pages worth probing, cheapest signal first:
 * the paste itself, then links the homepage itself offers, then the sitemap,
 * then the two or three paths WordPress sites use by convention.
 *
 * Same-origin only. Following a "Bilety" link to a ticketing platform would
 * probe someone else's site and store it as the venue's source.
 */

/** Words that name a programme page, in Polish and English. */
const LISTING_WORDS = [
  'wydarzenia',
  'repertuar',
  'program',
  'kalendarz',
  'afisz',
  'wystawy',
  'spektakle',
  'events',
  'whats-on',
  'calendar',
  'agenda',
];

const LISTING_RE = new RegExp(LISTING_WORDS.join('|'), 'i');

/** Blind guesses, tried last because they cost a request each. */
const BLIND_PATHS = ['/wydarzenia', '/events', '/kalendarz'];

export const MAX_CANDIDATES = 6;
/** A big site's sitemap can list six figures of URLs; we only need the few
 *  that look like a programme, and reading all of them is a denial of service
 *  against ourselves. */
export const MAX_SITEMAP_URLS = 500;

/**
 * Candidate listing pages for `pageUrl`, in probe order. The normalized URL is
 * always first — when the user pasted the right page, nothing else is fetched.
 */
export async function findCandidates(
  pageUrl: string,
  html: string,
  fetcher: ProbeFetcher,
): Promise<string[]> {
  const base = new URL(pageUrl);
  const out: string[] = [pageUrl];

  for (const href of listingLinks(html, pageUrl, base)) push(out, href);

  if (out.length < MAX_CANDIDATES) {
    for (const href of await sitemapLinks(base, fetcher)) push(out, href);
  }

  for (const path of BLIND_PATHS) {
    push(out, new URL(path, base).toString());
  }

  return out.slice(0, MAX_CANDIDATES);

  function push(list: string[], href: string) {
    if (list.length >= MAX_CANDIDATES) return;
    if (!list.includes(href)) list.push(href);
  }
}

/** Same-origin links whose href *or* link text names a programme page — the
 *  text matters because plenty of sites route through `/pl/p/1234`. */
function listingLinks(html: string, pageUrl: string, base: URL): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!LISTING_RE.test(href) && !LISTING_RE.test(text)) return;

    let abs: URL;
    try {
      abs = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (abs.origin !== base.origin) return;
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return;
    abs.hash = '';
    out.push(abs.toString());
  });

  return [...new Set(out)];
}

/**
 * Programme-looking URLs from `/sitemap.xml`, following one level of sitemap
 * index. Bounded at {@link MAX_SITEMAP_URLS} entries read in total.
 */
async function sitemapLinks(base: URL, fetcher: ProbeFetcher): Promise<string[]> {
  const res = await fetcher(new URL('/sitemap.xml', base).toString(), {
    accept: 'application/xml,text/xml',
  });
  if (!res.ok) return [];

  const { urls, sitemaps } = parseSitemap(res.body);
  let all = urls;

  // A sitemap index points at more sitemaps. One level only — chains deeper
  // than that are a crawl, not a probe.
  for (const child of sitemaps.slice(0, 3)) {
    if (all.length >= MAX_SITEMAP_URLS) break;
    const childRes = await fetcher(child, { accept: 'application/xml,text/xml' });
    if (!childRes.ok) continue;
    all = all.concat(parseSitemap(childRes.body).urls);
  }

  return all
    .slice(0, MAX_SITEMAP_URLS)
    .filter((u) => {
      try {
        const parsed = new URL(u);
        return parsed.origin === base.origin && LISTING_RE.test(parsed.pathname);
      } catch {
        return false;
      }
    })
    // Shallower paths first: `/wydarzenia` is the listing, `/wydarzenia/2019/x`
    // is one archived entry.
    .sort((a, b) => pathDepth(a) - pathDepth(b));
}

export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const $ = cheerio.load(xml, { xmlMode: true });
  const urls: string[] = [];
  const sitemaps: string[] = [];

  $('urlset > url > loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) urls.push(loc);
  });
  $('sitemapindex > sitemap > loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) sitemaps.push(loc);
  });

  return { urls, sitemaps };
}

function pathDepth(u: string): number {
  try {
    return new URL(u).pathname.split('/').filter(Boolean).length;
  } catch {
    return 99;
  }
}

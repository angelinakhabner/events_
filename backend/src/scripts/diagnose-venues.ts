/**
 * TEMPORARY diagnostic helper (runs from the venue-diagnose workflow).
 *
 * Three probes, all driven from an Actions runner because the dev sandbox has
 * no egress to the venues or the deployed backend:
 *
 * 1. TRIGGER: force a production scrape for each venue in DIAG_TRIGGER
 *    (slugs from default-venues.ts) via the public admin.triggerScrape tRPC
 *    mutation, then re-read events.listByVenue. Surfaces the real production
 *    status/errorMessage for venues whose scrapes silently yield nothing.
 *
 * 2. DISCOVER: for each venue in DIAG_DISCOVER, fetch its current listing page,
 *    collect same-site links that look like event calendars (wydarzen/kalend/
 *    program/event), and run probeVenueUrl on each candidate — finds the URL a
 *    venue SHOULD point at when the seeded one can't yield dated events.
 *
 * 3. ANALYZE: for each venue in DIAG_ANALYZE, fetch + preprocess the page and
 *    report clock-time / month-name counts in the cleaned text — distinguishes
 *    "listing is genuinely empty (summer break)" from "extraction is failing".
 *
 * Prints a JSON report between DIAG_JSON markers.
 */
import * as cheerio from 'cheerio';
import { DEFAULT_VENUES } from '../data/default-venues.js';
import { fetchVenueHTML } from '../services/scraper/fetcher.js';
import { preprocessForVenue } from '../services/scraper/preprocessor.js';
import { probeVenueUrl } from '../services/scraper/probe.js';
import { resolveVenueUrl } from '../services/scraper/runner.js';

const API = (process.env.DIAG_API_URL ?? '').replace(/\/+$/, '');
const TRIGGER = csv(process.env.DIAG_TRIGGER);
const DISCOVER = csv(process.env.DIAG_DISCOVER);
const ANALYZE = csv(process.env.DIAG_ANALYZE);

function csv(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function venueBySlug(slug: string) {
  const v = DEFAULT_VENUES.find((d) => d.id === slug);
  if (!v) throw new Error(`unknown venue slug: ${slug}`);
  return v;
}

async function apiVenueId(slug: string): Promise<{ id: string | null; listError: string | null }> {
  const v = venueBySlug(slug);
  let res: Response;
  try {
    res = await fetch(`${API}/trpc/venues.list`);
  } catch (e) {
    return { id: null, listError: `venues.list fetch threw: ${e instanceof Error ? e.message : String(e)}` };
  }
  const body = await res.text();
  if (!res.ok) {
    return { id: null, listError: `venues.list HTTP ${res.status}: ${body.slice(0, 300)}` };
  }
  let json: { result?: { data?: Array<{ id: string; name: string; url: string }> } };
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    return { id: null, listError: `venues.list returned non-JSON: ${body.slice(0, 300)}` };
  }
  const rows = json.result?.data ?? [];
  const id = rows.find((r) => r.url === v.url)?.id ?? rows.find((r) => r.name === v.name)?.id ?? null;
  return { id, listError: id ? null : `no match among ${rows.length} venues` };
}

async function triggerScrape(slug: string): Promise<unknown> {
  const { id, listError } = await apiVenueId(slug);
  if (!id) return { slug, error: `venue not resolved: ${listError}` };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    const res = await fetch(`${API}/trpc/admin.triggerScrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venueId: id, force: true }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as {
      result?: { data?: unknown };
      error?: { message?: string };
    } | null;
    const run = body?.result?.data ?? null;
    // Post-scrape visibility check.
    const input = encodeURIComponent(JSON.stringify({ venueId: id }));
    const after = await fetch(`${API}/trpc/events.listByVenue?input=${input}`);
    const afterJson = (await after.json().catch(() => null)) as { result?: { data?: Array<{ startsAt: string }> } } | null;
    const rows = afterJson?.result?.data ?? [];
    return {
      slug,
      httpStatus: res.status,
      run,
      trpcError: body?.error?.message ?? null,
      visibleAfter: rows.length,
      lastStartsAt: rows[rows.length - 1]?.startsAt ?? null,
    };
  } catch (e) {
    return { slug, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

const CANDIDATE_RE = /wydarzen|kalend|program|event|repertuar|calendar/i;

async function discover(slug: string): Promise<unknown> {
  const venue = venueBySlug(slug);
  const url = resolveVenueUrl(venue.url, new Date(), venue.timezone);
  let html: string;
  try {
    html = await fetchVenueHTML(url);
  } catch (e) {
    return { slug, error: e instanceof Error ? e.message : String(e) };
  }
  const $ = cheerio.load(html);
  const base = new URL(url);
  const seen = new Set<string>();
  const candidates: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      return;
    }
    // Same registrable site only (mnw.art.pl vs krolikarnia.mnw.art.pl both ok).
    if (!abs.hostname.endsWith(base.hostname.split('.').slice(-2).join('.'))) return;
    const clean = `${abs.origin}${abs.pathname}`;
    if (!CANDIDATE_RE.test(abs.pathname)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    candidates.push(clean);
  });
  const probes: unknown[] = [];
  for (const candidate of candidates.slice(0, 8)) {
    console.error(`[diag] probing ${candidate} …`);
    const p = await probeVenueUrl(candidate).catch((e) => ({ ok: false, reason: String(e) }));
    probes.push({ url: candidate, ...p });
  }
  return { slug, page: url, candidates, probes };
}

const MONTHS = [
  'stycz', 'lut', 'marz', 'kwiet', 'maj', 'czerw', 'lip', 'sierp', 'wrze', 'paźdz', 'listopad', 'grud',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
];

async function analyze(slug: string): Promise<unknown> {
  const venue = venueBySlug(slug);
  const url = resolveVenueUrl(venue.url, new Date(), venue.timezone);
  let html: string;
  try {
    html = await fetchVenueHTML(url);
  } catch (e) {
    return { slug, error: e instanceof Error ? e.message : String(e) };
  }
  const { cleaned, structured } = preprocessForVenue(html, venue);
  const text = cleaned.toLowerCase();
  const clockTimes = (text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) ?? []).length;
  const isoDates = (text.match(/\b20\d{2}-\d{2}-\d{2}\b/g) ?? []).length;
  const monthMentions: Record<string, number> = {};
  for (const m of MONTHS) {
    const n = text.split(m).length - 1;
    if (n > 0) monthMentions[m] = n;
  }
  // Hunt for the JSON/API endpoints a JS-rendered page actually loads its
  // listing from — an API we can hit directly beats rendering the page.
  const origin = new URL(url).origin;
  const apiHints = new Set<string>();
  for (const m of html.matchAll(/["'](https?:\/\/[^"'\s]{5,200}|\/[^"'\s]{3,200})["']/g)) {
    const cand = m[1]!;
    if (/(api|json|graphql|admin-ajax|wp-json|repertuar|kalendarz|events?)[^"']*/i.test(cand) && !/\.(css|js|png|jpe?g|svg|webp|woff2?|ico)(\?|$)/i.test(cand)) {
      apiHints.add(cand.startsWith('/') ? `${origin}${cand}` : cand);
      if (apiHints.size >= 25) break;
    }
  }
  // WordPress fingerprint: the REST index is a machine-readable event source.
  let wpJson: string | null = null;
  if (/wp-content|wp-includes/.test(html)) {
    try {
      const res = await fetch(`${origin}/wp-json/`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      wpJson = `HTTP ${res.status}`;
    } catch (e) {
      wpJson = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return {
    slug,
    page: url,
    cleanedChars: cleaned.trim().length,
    structuredSource: structured?.source ?? null,
    clockTimes,
    isoDates,
    monthMentions,
    isWordPress: /wp-content|wp-includes/.test(html),
    wpJsonProbe: wpJson,
    apiHints: [...apiHints],
    sample: cleaned.trim().replace(/\s+/g, ' ').slice(0, 600),
  };
}

async function main(): Promise<void> {
  const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), apiUrl: API || null };

  if (TRIGGER.length) {
    const out: unknown[] = [];
    for (const slug of TRIGGER) {
      console.error(`[diag] trigger ${slug} …`);
      out.push(await triggerScrape(slug));
    }
    report.trigger = out;
  }
  if (DISCOVER.length) {
    const out: unknown[] = [];
    for (const slug of DISCOVER) {
      console.error(`[diag] discover ${slug} …`);
      out.push(await discover(slug));
    }
    report.discover = out;
  }
  if (ANALYZE.length) {
    const out: unknown[] = [];
    for (const slug of ANALYZE) {
      console.error(`[diag] analyze ${slug} …`);
      out.push(await analyze(slug));
    }
    report.analyze = out;
  }

  console.log('===DIAG_JSON_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===DIAG_JSON_END===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

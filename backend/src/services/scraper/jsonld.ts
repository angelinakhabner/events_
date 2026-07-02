import { clean } from './enricher.js';

// Deterministic extraction from schema.org JSON-LD event nodes.
//
// Since the preprocessor started sending *only* the JSON-LD payload to the
// model whenever a page carries ≥2 event nodes, the LLM's job on those venues
// is transcribing JSON into JSON — same fields in, same fields out. This module
// does that mapping in code instead: zero Anthropic tokens, exact values, and
// no information loss by construction (the model never saw anything we don't).
//
// The runner still falls back to the LLM when this parser yields nothing
// usable — e.g. JSON-LD whose dates live in free-text fields our mapper can't
// read but the model can.

export interface JsonLdRawEvent {
  title: string;
  starts_at: string;
  duration_minutes: number | null;
  language: string | null;
  director: string | null;
  cast: string[] | null;
  description: string | null;
  price_min: number | null;
  price_max: number | null;
  source_url: string;
  source_id: string | null;
}

export interface ParseJsonLdOptions {
  /** Listing page URL — fallback source_url and base for resolving relative hrefs. */
  pageUrl: string;
  /** Reference "today" for the scrape window. */
  today: Date;
  /** Days ahead (inclusive) to keep events for — same window the LLM was given. */
  windowDays: number;
}

/**
 * Map schema.org Event-like nodes to extractor-shaped rows, applying the same
 * window rule the LLM prompt states: keep events starting from today through
 * today+windowDays; an already-running engagement (endDate in the future)
 * counts even if it started earlier.
 */
export function parseJsonLdEvents(nodes: unknown[], opts: ParseJsonLdOptions): JsonLdRawEvent[] {
  const windowStart = startOfDayUtc(opts.today);
  const windowEnd = new Date(opts.today.getTime() + opts.windowDays * 86_400_000);

  const out: JsonLdRawEvent[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const n = node as Record<string, unknown>;

    const title = firstString(n.name);
    const startsAt = firstString(n.startDate);
    if (!title || !startsAt) continue;
    const startMs = Date.parse(startsAt);
    if (Number.isNaN(startMs)) continue;

    // Window filter (mirrors the prompt): skip past events unless still
    // running, skip anything beyond the horizon.
    const endRaw = firstString(n.endDate);
    const endMs = endRaw ? Date.parse(endRaw) : NaN;
    const stillRunning = !Number.isNaN(endMs) && endMs >= opts.today.getTime();
    if (startMs > windowEnd.getTime()) continue;
    if (startMs < windowStart.getTime() && !stillRunning) continue;

    const { min, max } = extractPrices(n.offers);
    out.push({
      title,
      starts_at: startsAt,
      duration_minutes: parseIsoDurationMinutes(firstString(n.duration)),
      language: firstString(n.inLanguage) ?? nameOf(n.inLanguage),
      director: nameOf(n.director),
      cast: namesOf(n.actor) ?? namesOf(n.performer),
      description: cleanDescription(firstString(n.description)),
      price_min: min,
      price_max: max,
      source_url: resolveUrl(firstString(n.url) ?? firstString(n['@id']), opts.pageUrl),
      source_id: firstString(n['@id']),
    });
  }
  return out;
}

/** UTC midnight of the calendar day containing `d` — a lenient lower bound so
 *  "earlier today" events aren't dropped mid-sweep regardless of timezone. */
function startOfDayUtc(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/** First usable string from a value that may be a string or an array of them. */
function firstString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = firstString(item);
      if (s) return s;
    }
  }
  return null;
}

/** `name` of a Person/Thing node (or the first of an array of them). */
function nameOf(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v)) return nameOf(v[0]);
  if (typeof v === 'object') return firstString((v as Record<string, unknown>).name);
  return null;
}

/** Names of an array (or single) of Person nodes. */
function namesOf(v: unknown): string[] | null {
  if (!v) return null;
  const list = Array.isArray(v) ? v : [v];
  const names = list.map(nameOf).filter((s): s is string => !!s);
  return names.length ? names : null;
}

/** "PT1H30M" / "PT105M" → minutes, or null when absent/unparseable. */
export function parseIsoDurationMinutes(v: string | null): number | null {
  if (!v) return null;
  const m = v.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/i);
  if (!m) return null;
  const minutes = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return minutes > 0 ? minutes : null;
}

/** offers (single node or array) → price range in grosze. Only trusts PLN (or
 *  currency-less) offers — a EUR price silently converted would be wrong. */
function extractPrices(offers: unknown): { min: number | null; max: number | null } {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  const values: number[] = [];
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    const offer = o as Record<string, unknown>;
    const currency = firstString(offer.priceCurrency);
    if (currency && currency.toUpperCase() !== 'PLN') continue;
    for (const key of ['price', 'lowPrice', 'highPrice']) {
      const num = toNumber(offer[key]);
      if (num !== null && num >= 0) values.push(Math.round(num * 100));
    }
  }
  if (!values.length) return { min: null, max: null };
  return { min: Math.min(...values), max: Math.max(...values) };
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Strip inline HTML tags, then reuse the enricher's whitespace-collapse and
 *  ~200-char sentence-aware clamp so descriptions match the LLM-era length. */
function cleanDescription(v: string | null): string | null {
  if (!v) return null;
  const text = clean(v.replace(/<[^>]+>/g, ' '));
  return text || null;
}

function resolveUrl(u: string | null, pageUrl: string): string {
  if (u) {
    try {
      const abs = new URL(u, pageUrl);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') return abs.toString();
    } catch {
      /* fall through to pageUrl */
    }
  }
  return pageUrl;
}

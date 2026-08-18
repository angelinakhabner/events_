import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../config.js';
import { extractJson } from './ai-parser.js';
import { normalizedHref } from './probe/normalize.js';

/**
 * "Propose me similar venues in city X, like the ones in my folder Y" (GOI-86).
 *
 * The folder is the taste signal. Someone whose "Warsaw" folder holds POLIN,
 * Zachęta and the Museum of Modern Art is not asking for "museums in Berlin"
 * — they are asking for *that kind* of museum, and a plain category filter
 * cannot express it. So the model is given the actual venues as exemplars and
 * asked to match their character in the target city.
 *
 * What comes back is a *suggestion*, never a subscription. Each one still goes
 * through the ordinary add-venue path, which probes the URL and finds out
 * whether it can be scraped at all — so a hallucinated address fails there,
 * visibly, instead of quietly becoming a venue that never yields events.
 */

/** The categories a suggestion may claim. Mirrors `Category` in shared, minus
 *  'other': asking the model to pick a bucket only helps if the buckets mean
 *  something, and 'other' is where a guess goes to hide. */
const SUGGESTED_CATEGORIES = ['cinema', 'theatre', 'exhibition', 'comedy', 'music'] as const;

export const SuggestedVenue = z.object({
  name: z.string().min(1).max(120),
  /** The venue's own homepage. Validated as a URL here; whether it is
   *  *reachable and scrapeable* is the probe's job at add time. */
  url: z.string().url(),
  city: z.string().min(1).max(80),
  /** ISO-3166 alpha-2, upper-cased by the schema so 'de' and 'DE' agree. */
  country: z.string().trim().length(2).toUpperCase(),
  category: z.enum(SUGGESTED_CATEGORIES),
  /** One line on why this matches the exemplars — the whole value of asking a
   *  model rather than running a directory search. Shown in the UI. */
  why: z.string().min(1).max(240),
});
export type SuggestedVenue = z.infer<typeof SuggestedVenue>;

/** One exemplar from the source folder, as the prompt sees it. */
export interface VenueExemplar {
  name: string;
  city: string;
  category: string;
  /** The user's own tags — often the sharpest signal ("arthouse", "free"). */
  tags?: string[];
}

export interface SuggestOptions {
  /** Venues from the folder being matched against. */
  like: VenueExemplar[];
  /** Target city, as typed ("Berlin"). */
  city: string;
  /** Optional narrowing: "Museums", "arthouse cinemas". Free text on purpose
   *  — the ticket's example ("Type XXX") is a phrase, not an enum. */
  type?: string;
  /** How many to ask for. */
  limit?: number;
  /** Injectable for tests. */
  complete?: (prompt: string, system: string) => Promise<string>;
}

const SYSTEM = `You recommend cultural venues (cinemas, theatres, museums/galleries, comedy clubs, music venues).

You are given venues someone already follows, and a target city. Propose venues in the target city that match the CHARACTER of the examples — their scale, programming and spirit — not merely their category. If the examples are independent arthouse cinemas, do not propose multiplexes.

Rules:
- Only real, currently-operating venues in the target city.
- "url" must be the venue's own official homepage. If you are not confident of the exact address, omit that venue entirely rather than guessing.
- Never repeat a venue that appears in the examples.
- "why" is one short sentence tying it to the examples.
- Output a JSON array only. No prose, no markdown fence.

Shape: [{ "name", "url", "city", "country" (ISO-3166 alpha-2), "category" (one of: cinema, theatre, exhibition, comedy, music), "why" }]`;

/** The exemplar block, kept compact — it is the bulk of the prompt. */
export function describeExemplars(like: VenueExemplar[]): string {
  if (like.length === 0) return '(the folder is empty)';
  return like
    .map((v) => {
      const tags = v.tags?.length ? ` [tags: ${v.tags.join(', ')}]` : '';
      return `- ${v.name} (${v.city}, ${v.category})${tags}`;
    })
    .join('\n');
}

export function buildPrompt(opts: Pick<SuggestOptions, 'like' | 'city' | 'type' | 'limit'>): string {
  const wanted = opts.limit ?? 6;
  const type = opts.type?.trim();
  return [
    `Venues already followed:\n${describeExemplars(opts.like)}`,
    '',
    `Target city: ${opts.city.trim()}`,
    type ? `Type wanted: ${type}` : 'Type wanted: anything matching the examples',
    '',
    `Propose up to ${wanted} venues. Fewer is fine — quality over count.`,
  ].join('\n');
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return _client;
}

async function completeWithClaude(prompt: string, system: string): Promise<string> {
  const resp = await client().messages.create({
    model: env.VENUE_SUGGEST_MODEL,
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: prompt }],
  });
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Drop anything the user already follows, and anything the model returned
 * twice. Matched on normalized URL first (the identity the venue store itself
 * dedupes on) and on name+city second, since the same venue is easily reached
 * by two addresses.
 */
export function dedupe(suggestions: SuggestedVenue[], existing: VenueExemplar[] = [], existingUrls: string[] = []): SuggestedVenue[] {
  const seenUrl = new Set(existingUrls.map((u) => normalizedHref(u)).filter((u): u is string => !!u));
  const seenName = new Set(existing.map((v) => `${v.name.trim().toLowerCase()}|${v.city.trim().toLowerCase()}`));
  const out: SuggestedVenue[] = [];
  for (const s of suggestions) {
    const href = normalizedHref(s.url);
    const nameKey = `${s.name.trim().toLowerCase()}|${s.city.trim().toLowerCase()}`;
    if (href && seenUrl.has(href)) continue;
    if (seenName.has(nameKey)) continue;
    if (href) seenUrl.add(href);
    seenName.add(nameKey);
    out.push(s);
  }
  return out;
}

/**
 * Ask for venues in `city` resembling the folder's own.
 *
 * Invalid entries are dropped rather than failing the whole call: one bad URL
 * in six should not cost the user the other five. A response that parses to
 * nothing usable throws, because that is a real failure and silently showing
 * "no suggestions" would hide it.
 */
export async function suggestSimilarVenues(opts: SuggestOptions): Promise<SuggestedVenue[]> {
  const city = opts.city.trim();
  if (!city) throw new Error('A target city is required');

  const complete = opts.complete ?? completeWithClaude;
  const text = await complete(buildPrompt(opts), SYSTEM);

  // extractJson throws a raw JSON.parse error on prose ("I could not find
  // anything."), which would reach the user as `Unexpected token 'I'`. The
  // caller cannot act on that; "did not return a list" is at least true.
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    throw new Error('The model did not return a list of venues');
  }
  const parsed = z.array(z.unknown()).safeParse(raw);
  if (!parsed.success) {
    throw new Error('The model did not return a list of venues');
  }
  const valid = parsed.data
    .map((row) => SuggestedVenue.safeParse(row))
    .filter((r): r is { success: true; data: SuggestedVenue } => r.success)
    .map((r) => r.data);

  if (valid.length === 0 && parsed.data.length > 0) {
    throw new Error('The model returned venues, but none had a usable name and homepage');
  }
  return valid.slice(0, opts.limit ?? 6);
}

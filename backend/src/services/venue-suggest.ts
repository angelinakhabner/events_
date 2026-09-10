import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../config.js';
import { extractJson } from './ai-parser.js';
import { normalizedHref } from './probe/normalize.js';

/**
 * "Find me jazz concerts in Thessaloniki tomorrow" — venue discovery from a
 * city, a date window and what you are actually in the mood for (GOI-86).
 *
 * Four things narrow the ask, and each does a different job:
 *
 * - **City** is the only required one.
 * - **Interest** is free text ("jazz concerts", "arthouse films"). A genre is
 *   not a venue category, and it is usually the sharpest thing someone can
 *   say about what they want.
 * - **Types** are the app's own venue categories, so the answer stays inside
 *   the vocabulary the rest of the tab filters on.
 * - **Dates** shape which venues are worth proposing at all — a summer stage
 *   is a bad answer in January. What the model is *not* asked for is a
 *   listing: it cannot know what is on tomorrow, so it is told not to claim
 *   it. The dates are then checked for real against each candidate's own
 *   programme, which the probe reads.
 *
 * A folder of venues can still be handed in as taste exemplars. Someone whose
 * "Warsaw" folder holds POLIN, Zachęta and the Museum of Modern Art is not
 * asking for "museums in Berlin" — they are asking for *that kind* of museum,
 * and no category filter expresses it. It is optional now: a search for jazz
 * in a city you have never been to needs no exemplars to be a good ask.
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
  /** One line on why this matches the ask — the genre, the venue type or the
   *  exemplars. The whole value of asking a model rather than running a
   *  directory search. Shown in the UI. */
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
  /** Venues from the folder being matched against, if one was chosen. */
  like?: VenueExemplar[];
  /** Target city, as typed ("Berlin"). */
  city: string;
  /** What they are after, in their own words: "jazz concerts", "arthouse
   *  films". Free text on purpose — a genre is not a category, and it is the
   *  part of the ask that a dropdown cannot hold. */
  interest?: string;
  /** Venue categories wanted, as labels ("Music", "Museums"). Empty means
   *  anything. */
  types?: string[];
  /** Window the search is for, as ISO dates (`YYYY-MM-DD`), inclusive. Either
   *  end may stand alone; both absent means "any time". */
  from?: string;
  until?: string;
  /** How many to ask for. */
  limit?: number;
  /** Injectable for tests. */
  complete?: (prompt: string, system: string) => Promise<string>;
}

const SYSTEM = `You recommend cultural venues (cinemas, theatres, museums/galleries, comedy clubs, music venues).

You are given a target city and, in some combination: what kind of night out someone is after, the venue types they care about, the dates they will be there, and venues they already follow as examples of their taste.

Propose venues in the target city where what they asked for actually happens — a venue that programmes that genre regularly, not one that could conceivably host it once. When examples are given, match their CHARACTER — scale, programming, spirit — not merely their category: if the examples are independent arthouse cinemas, do not propose multiplexes.

Rules:
- Only real, currently-operating venues in the target city.
- "url" must be the venue's own official homepage. If you are not confident of the exact address, omit that venue entirely rather than guessing.
- Never repeat a venue that appears in the examples.
- Treat the dates as context for which venues are worth proposing (a summer-only open-air stage is a bad answer in January), NOT as something to describe. Do not claim any specific event is on: each venue's own programme is read separately, and an invented listing is contradicted there.
- "why" is one short sentence tying the venue to what was asked for — the genre, the venue type, or the examples.
- Output a JSON array only. No prose, no markdown fence.

Shape: [{ "name", "url", "city", "country" (ISO-3166 alpha-2), "category" (one of: cinema, theatre, exhibition, comedy, music), "why" }]`;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * An ISO day as a phrase the prompt can carry: "Fri, 11 Sep 2026".
 *
 * Spelled out here rather than through `Intl` deliberately. The prompt is an
 * input to a model, and it should not quietly change wording ("Sep" vs
 * "Sept") because the server's ICU data was upgraded underneath it.
 */
function day(iso: string): string {
  const at = new Date(`${iso}T00:00:00.000Z`);
  return `${WEEKDAYS[at.getUTCDay()]}, ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/**
 * The date window as one line: "Fri, 11 Sep 2026 (one day)", "11–14 Sep",
 * "from … onwards", or "any time".
 *
 * Spelled out rather than passed as raw ISO because the weekday is the part
 * that changes the answer — "which venues are worth proposing on a Tuesday"
 * is a different question from the same date on a Saturday.
 */
export function describeWindow(from?: string, until?: string): string {
  if (from && until) {
    return from === until ? `${day(from)} (one day)` : `${day(from)} to ${day(until)}`;
  }
  if (from) return `${day(from)} onwards`;
  if (until) return `up to and including ${day(until)}`;
  return 'any time — no dates given';
}

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

export function buildPrompt(
  opts: Pick<SuggestOptions, 'like' | 'city' | 'interest' | 'types' | 'from' | 'until' | 'limit'>,
): string {
  const wanted = opts.limit ?? 6;
  const interest = opts.interest?.trim();
  const types = (opts.types ?? []).map((t) => t.trim()).filter(Boolean);
  const like = opts.like ?? [];
  return [
    `Target city: ${opts.city.trim()}`,
    `Dates: ${describeWindow(opts.from, opts.until)}`,
    `Looking for: ${interest || 'anything worth going to'}`,
    `Venue types wanted: ${types.length ? types.join(', ') : 'any'}`,
    '',
    // The exemplar block is the bulk of the prompt when it exists, and
    // nothing at all when it does not — an empty "Venues already followed"
    // heading would read as "they follow nothing", which is a different and
    // misleading fact about someone who simply searched without a folder.
    like.length
      ? `Venues they already follow, as examples of their taste:\n${describeExemplars(like)}`
      : 'No example venues were given — go on the city, the interest and the types alone.',
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
 * Ask for venues in `city` matching the interest, the types, the dates and —
 * when a folder was chosen — its venues.
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

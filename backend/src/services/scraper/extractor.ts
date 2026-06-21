import Anthropic from '@anthropic-ai/sdk';
import { jsonrepair } from 'jsonrepair';
import type { Venue } from '@goin/shared';
import { env } from '../../config.js';

// Model choice: claude-sonnet-4-6 (latest Sonnet) — best price/accuracy balance
// for structured HTML extraction. Opus is overkill for this task; Haiku risks
// reliability on messy real-world venue HTML with Polish content and ambiguous
// date formats. Sonnet 4.6 handles structured extraction with high fidelity
// at a fraction of Opus cost.
export const MODEL = 'claude-sonnet-4-6';
// Sonnet 4.6 supports 64k output tokens. Even with the 7-day window, the
// biggest venue (Kino Muranów) overflowed 16k — a real sweep showed
// `input 121452t, output 16000t` (truncated). 48k gives ample headroom; you
// only pay for tokens actually generated, the cap is just a ceiling. Requests
// this large must stream (see extract()) to avoid SDK HTTP timeouts.
const MAX_TOKENS = 48_000;

// Bump this constant whenever the prompt or output schema changes in a way
// that should invalidate previously-cached scrape results. The runner mixes
// this into the raw_hash comparison so a re-deploy with a tuned prompt
// re-extracts existing pages instead of silently keeping stale outputs.
// v3: enricher pass now fills `description` from each event's source_url.
// v4: forced record_events tool call (structured JSON, no escaping bugs).
// v5: bound extraction to a rolling N-day window (default 7). A cinema's full
// repertoire (Muranów ~100+ screenings) overflowed the 16k output budget and
// truncated the tool call mid-array, failing the whole venue. A week's worth
// fits comfortably, so we keep one bounded call per venue at the current
// budget — and a week is a week for any user-added source. Bumping the version
// invalidates raw_hash so the next sweep re-extracts.
// v6: per-category scrape window (cinema 7d … exhibition 60d) — a flat 7-day
// window missed sparse venues whose nearest event was just outside it (e.g.
// Filharmonia). Re-extract so those venues pick up their wider horizon.
// v7: prompt now tells the model to combine a card's separate date + standalone
// HH:MM (e.g. Kinoteka shows "21.06.2026" and "18:00" apart) instead of
// defaulting to 00:00 — those midnight rows were being dropped by the validator.
export const EXTRACTOR_VERSION = 7;

const SYSTEM_PROMPT =
  'You are a precise data extractor for cultural event listings. ' +
  'Record every event you find by calling the record_events tool. ' +
  'Never invent data. If a field is not in the source, use null.';

// Single tool the model is forced to call. The API returns tool_use `input` as
// structured JSON, which is the whole point — it bypasses free-text JSON
// generation and the escaping bugs that come with it.
const EVENT_TOOL: Anthropic.Tool = {
  name: 'record_events',
  description: 'Record every extracted event. Call exactly once, passing all events in the `events` array.',
  input_schema: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            starts_at: {
              type: 'string',
              description: 'ISO 8601 with timezone offset, e.g. "2026-06-08T18:00:00+02:00"',
            },
            duration_minutes: { type: ['integer', 'null'] },
            language: { type: ['string', 'null'] },
            director: { type: ['string', 'null'] },
            cast: { type: ['array', 'null'], items: { type: 'string' } },
            description: { type: ['string', 'null'], description: '1-2 sentences max' },
            price_min: { type: ['integer', 'null'], description: 'in grosze (integer)' },
            price_max: { type: ['integer', 'null'] },
            source_url: { type: 'string' },
            source_id: { type: ['string', 'null'] },
          },
          // Every key is required-but-nullable: the validator's EventSchema uses
          // .nullable() (not .optional()), so a *missing* key fails validation
          // and the event is dropped. Listing all keys here forces the model to
          // emit each one (value or null), matching that contract.
          required: [
            'title',
            'starts_at',
            'duration_minutes',
            'language',
            'director',
            'cast',
            'description',
            'price_min',
            'price_max',
            'source_url',
            'source_id',
          ],
        },
      },
    },
    required: ['events'],
  },
};

export interface ExtractorClient {
  extract(args: { system: string; user: string }): Promise<string>;
}

class AnthropicExtractor implements ExtractorClient {
  private client: Anthropic;
  constructor(apiKey: string) {
    // maxRetries: 6 lets the SDK honour Anthropic's `retry-after` header for
    // 429 / 5xx (default is 2, which loses scrapes when a same-minute burst
    // pushes us past the 30k input-tokens/minute org cap). With backoff the
    // worst case adds a few minutes to the daily sweep — acceptable for cron.
    this.client = new Anthropic({ apiKey, maxRetries: 6 });
  }
  async extract({ system, user }: { system: string; user: string }): Promise<string> {
    // Stream and assemble the final message: at MAX_TOKENS this large a
    // non-streaming request risks an SDK HTTP timeout before the body lands.
    const resp = await this.client.messages
      .stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: [EVENT_TOOL],
        // Force the call so the model can't answer in prose and skip the tool.
        tool_choice: { type: 'tool', name: EVENT_TOOL.name },
        messages: [{ role: 'user', content: user }],
      })
      .finalMessage();
    return toolResponseToJson(resp);
  }
}

/**
 * Pull the events array out of a forced `record_events` tool call and return it
 * as a JSON string (so the existing `parseJsonArray` path stays the single
 * parser). Exported for unit testing without a live client.
 */
export function toolResponseToJson(resp: Anthropic.Message): string {
  if (resp.stop_reason === 'max_tokens') {
    throw new Error(
      `Extractor hit max_tokens (${MAX_TOKENS}) — tool input truncated. ` +
        `Narrow the scrape window or raise MAX_TOKENS. Input usage: ${resp.usage.input_tokens}t, output: ${resp.usage.output_tokens}t.`,
    );
  }
  const toolUse = resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Extractor returned no tool_use block (expected a forced record_events call)');
  }
  // input is `unknown`; accept the {events:[...]} shape and, defensively, a bare array.
  const input = toolUse.input as { events?: unknown } | unknown[];
  const events = Array.isArray(input) ? input : input?.events;
  if (Array.isArray(events)) {
    return JSON.stringify(events);
  }
  // Observed on Muranów / Iluzjon / Klub Komediowy: the model serialises the
  // whole array into `events` as a JSON *string* (`{"events": "[{...}]"}`)
  // instead of an array. Return that string raw so the caller's parseJsonArray
  // (with its jsonrepair fallback) parses — or repairs a truncated one.
  if (typeof events === 'string' && events.trim()) {
    return events;
  }
  // Genuinely nothing usable — surface what the model returned for diagnosis.
  const keys = input && typeof input === 'object' ? Object.keys(input) : [];
  throw new Error(
    `Extractor tool_use input had no events array ` +
      `(input keys: [${keys.join(', ')}], events type: ${typeof (input as { events?: unknown })?.events}, ` +
      `output_tokens: ${resp.usage.output_tokens}, stop_reason: ${resp.stop_reason})`,
  );
}

let _defaultClient: ExtractorClient | null = null;
function defaultClient(): ExtractorClient {
  if (!_defaultClient) {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    _defaultClient = new AnthropicExtractor(env.ANTHROPIC_API_KEY);
  }
  return _defaultClient;
}

/**
 * Scrape horizon in days, per venue category. Cinemas publish a dense daily
 * repertoire, so a short window keeps the LLM output bounded; theatres, concert
 * halls and galleries schedule sparsely and far ahead, so a week often catches
 * nothing (e.g. Filharmonia's nearest concert was 9 days out → success_empty).
 * Tuned so output stays small where events are dense and the horizon is wide
 * where they're sparse.
 */
export const WINDOW_DAYS_BY_CATEGORY: Record<string, number> = {
  cinema: 7,
  comedy: 21,
  theatre: 30,
  exhibition: 60,
  music: 45,
};
export const DEFAULT_WINDOW_DAYS = 30;

export function windowDaysForCategory(category: string | undefined): number {
  return (category && WINDOW_DAYS_BY_CATEGORY[category]) || DEFAULT_WINDOW_DAYS;
}

export interface ExtractOptions {
  client?: ExtractorClient;
  hint?: string | null;
  /** Override the category-derived horizon (days from `today`). */
  windowDays?: number;
}

export async function extractEvents(
  cleanedHtml: string,
  venue: Pick<Venue, 'name' | 'city' | 'timezone' | 'category' | 'url'>,
  today: Date,
  opts: ExtractOptions = {},
): Promise<unknown[]> {
  const client = opts.client ?? defaultClient();
  const tz = venue.timezone || 'Europe/Warsaw';
  const dateStr = today.toISOString().slice(0, 10);
  const year = today.getFullYear();

  const windowDays = opts.windowDays ?? windowDaysForCategory(venue.category);
  const windowEnd = new Date(today.getTime() + windowDays * 86_400_000).toISOString().slice(0, 10);

  const hintBlock = opts.hint ? `\n- Page hint: ${opts.hint}` : '';

  const user = `Extract events happening in the next ${windowDays} days from this venue's HTML.

CONTEXT:
- Venue: ${venue.name}
- City: ${venue.city}
- Timezone: ${tz}
- Category: ${venue.category}
- Page URL: ${venue.url}
- Today's date: ${dateStr}
- Window: today (${dateStr}) through ${windowEnd}, inclusive${hintBlock}

EACH SCREENING/PERFORMANCE IS ONE EVENT ROW.
If a film plays 3 times today and 2 times tomorrow, return 5 event objects.

SCHEMA (one object per event, passed in the record_events tool's events array):
{
  "title": string,
  "starts_at": string (ISO 8601 WITH timezone offset, e.g. "2026-06-08T18:00:00+02:00"),
  "duration_minutes": number | null,
  "language": string | null,
  "director": string | null,
  "cast": string[] | null,
  "description": string | null (1-2 sentences max),
  "price_min": number | null (in grosze — integer),
  "price_max": number | null,
  "source_url": string (see SOURCE_URL rules below),
  "source_id": string | null (the venue's internal id for this screening, e.g. from data-id attributes; null if not present)
}

SOURCE_URL — read this carefully:
- It MUST be the deepest stable page that describes THIS event itself: a per-film page, per-performance page, per-exhibition page. Look for <a> hrefs inside the screening block — typically /film/<slug>, /spektakl/<slug>, /wystawa/<slug>, or similar.
- NEVER use the venue's calendar / repertoire / "co gramy" / "program" page (e.g. ${venue.url}). That is a listing, not the event.
- If multiple screenings of the same film share one /film/<slug> page, that's fine — return that URL for each screening.
- If the page only links to an external ticket system for this seance, prefer the venue's own film/event page; only use the ticket URL if no per-event page exists.
- If you genuinely cannot find a per-event link in the HTML, return the venue URL but expect the row to be flagged.

RULES:
- ONLY events occurring from today (${dateStr}) through ${windowEnd}, inclusive, in venue timezone.
  Skip anything dated after ${windowEnd}. EXCEPTION: an exhibition currently on
  display counts even if it opened before today.
- If a field is not on the page, return null. NEVER guess.
- starts_at MUST carry the real clock time shown for that screening/performance.
  PREFER the exact start time from any structured data block at the top of the input
  (JSON-LD "startDate" / __NEXT_DATA__) over a time parsed from the HTML — it is the
  reliable source for showtimes on JS-rendered pages.
  The date and time are often shown SEPARATELY on a listing card — e.g. a date
  like "21.06.2026" near the top and a standalone clock time like "18:00" lower
  down (frequently next to a "Kup bilet" / buy-ticket button). COMBINE them into
  starts_at. Never emit 00:00 when an HH:MM appears anywhere on that event's card.
  If you cannot find a specific time, OMIT the event entirely — do NOT emit
  00:00 / midnight as a placeholder. (Exception: all-day exhibitions may use 00:00.)
- Year defaults to ${year} unless stated.
- Polish dates are common (e.g. "8 czerwca", "dziś", "jutro") — resolve them relative to today's date.
- Call the record_events tool exactly once with every event in its events array. Do not write any prose.

HTML:
${cleanedHtml}`;

  const text = await client.extract({ system: SYSTEM_PROMPT, user });
  return parseJsonArray(text);
}

export function parseJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : trimmed) ?? '';
  // Find the first '[' and last ']' to tolerate stray prose.
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    const preview = raw.length > 400 ? `${raw.slice(0, 200)} ... ${raw.slice(-200)}` : raw;
    throw new Error(
      `Extractor response did not contain a JSON array (length=${raw.length}, preview: ${JSON.stringify(preview)})`,
    );
  }
  const slice = raw.slice(start, end + 1);

  // Try strict parse first. Cheap when the output is clean.
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch (strictErr) {
    // Fall back to a repair pass. Production scrapes hit this often when
    // Polish event titles or descriptions contain bare double-quotes (e.g.
    // characters in cast lists, names quoted with "..."). jsonrepair fixes
    // unescaped quotes, trailing commas, single quotes, smart quotes,
    // missing brackets — common LLM JSON drift.
    try {
      const repaired = jsonrepair(slice);
      parsed = JSON.parse(repaired);
      // Only claim recovery once we know it actually produced an array.
      // Otherwise the next line throws "not a JSON array" and an earlier
      // "recovered N entries" log would be misleading.
      if (Array.isArray(parsed)) {
        console.warn(
          `[extractor] strict JSON.parse failed (${(strictErr as Error).message}); recovered ${parsed.length} entries via jsonrepair`,
        );
      }
    } catch (repairErr) {
      const previewAt = (strictErr as Error).message.match(/position (\d+)/)?.[1];
      const pos = previewAt ? Number(previewAt) : -1;
      const around =
        pos >= 0
          ? `near pos ${pos}: ${JSON.stringify(slice.slice(Math.max(0, pos - 80), pos + 80))}`
          : `head: ${JSON.stringify(slice.slice(0, 200))}`;
      throw new Error(
        `Extractor JSON could not be parsed or repaired: ${(strictErr as Error).message}; repair also failed: ${(repairErr as Error).message}; ${around}`,
      );
    }
  }

  if (!Array.isArray(parsed)) throw new Error('Extractor response is not a JSON array');
  return parsed;
}

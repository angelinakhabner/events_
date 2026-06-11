import Anthropic from '@anthropic-ai/sdk';
import type { Venue } from '@goin/shared';
import { env } from '../../config.js';

// Model choice: claude-sonnet-4-6 (latest Sonnet) — best price/accuracy balance
// for structured HTML extraction. Opus is overkill for this task; Haiku risks
// reliability on messy real-world venue HTML with Polish content and ambiguous
// date formats. Sonnet 4.6 handles structured extraction with high fidelity
// at a fraction of Opus cost.
export const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8000;

const SYSTEM_PROMPT =
  'You are a precise data extractor for cultural event listings. ' +
  'Output only valid JSON arrays. Never invent data. Never add prose ' +
  'or markdown. If a field is not in the source, return null.';

export interface ExtractorClient {
  extract(args: { system: string; user: string }): Promise<string>;
}

class AnthropicExtractor implements ExtractorClient {
  private client: Anthropic;
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }
  async extract({ system, user }: { system: string; user: string }): Promise<string> {
    const resp = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    });
    return resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
}

let _defaultClient: ExtractorClient | null = null;
function defaultClient(): ExtractorClient {
  if (!_defaultClient) {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    _defaultClient = new AnthropicExtractor(env.ANTHROPIC_API_KEY);
  }
  return _defaultClient;
}

export interface ExtractOptions {
  client?: ExtractorClient;
  hint?: string | null;
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

  const hintBlock = opts.hint ? `\n- Page hint: ${opts.hint}` : '';

  const user = `Extract all upcoming events from this venue's HTML.

CONTEXT:
- Venue: ${venue.name}
- City: ${venue.city}
- Timezone: ${tz}
- Category: ${venue.category}
- Page URL: ${venue.url}
- Today's date: ${dateStr}${hintBlock}

EACH SCREENING/PERFORMANCE IS ONE EVENT ROW.
If a film plays 3 times today and 2 times tomorrow, return 5 event objects.

SCHEMA (JSON array, each object matching this exactly):
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
  "source_url": string,
  "source_id": string | null (the venue's internal id for this screening, e.g. from data-id attributes; null if not present)
}

RULES:
- Only future events (starts_at >= today 00:00 in venue timezone)
- If a field is not on the page, return null. NEVER guess.
- Year defaults to ${year} unless stated.
- Polish dates are common (e.g. "8 czerwca", "dziś", "jutro") — resolve them relative to today's date.
- Output ONLY the JSON array. No prose, no code fences, no explanation.

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
    throw new Error('Extractor response did not contain a JSON array');
  }
  const json = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(json)) throw new Error('Extractor response is not a JSON array');
  return json;
}

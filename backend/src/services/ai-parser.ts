import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../config.js';

export const ParsedEvent = z.object({
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  director: z.string().nullable(),
  cast: z.array(z.string()).default([]),
  genre: z.string().nullable(),
  priceMin: z.number().nullable(),
  priceMax: z.number().nullable(),
  link: z.string(),
});
export type ParsedEvent = z.infer<typeof ParsedEvent>;

const PROMPT = `You extract cultural-event listings from raw HTML.
Return a JSON array of events with this shape:
{ title, description, startsAt (ISO 8601), endsAt, durationMinutes, director, cast[], genre, priceMin, priceMax, link }
Use null when a field is not present. Do not invent data. Output JSON only.`;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export async function parseEventsFromHtml(html: string, sourceUrl: string): Promise<ParsedEvent[]> {
  const trimmed = html.slice(0, 80_000);
  const resp = await client().messages.create({
    // Sonnet 4.6 — best balance of accuracy/cost for structured HTML extraction.
    // Opus is overkill for this task; Haiku risks reliability on messy HTML
    // with Polish content and ambiguous date formats.
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: PROMPT,
    messages: [
      { role: 'user', content: `Source URL: ${sourceUrl}\n\nHTML:\n${trimmed}` },
    ],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const json = extractJson(text);
  const parsed = z.array(ParsedEvent).safeParse(json);
  if (!parsed.success) {
    throw new Error(`AI returned invalid event payload: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  return JSON.parse(raw!.trim());
}

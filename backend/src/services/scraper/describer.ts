import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config.js';
import { MODEL } from './extractor.js';
import type { DescriptionClient, DescriptionResult } from './enricher.js';

/**
 * The model call behind detail-page enrichment (GOI-79).
 *
 * Deliberately not the event extractor: that one is a forced tool call
 * returning an array of events with a dozen fields, sized for a whole listing
 * page. This reads one page and returns one or two sentences, so it wants a
 * small `max_tokens` and plain text — and it reports token usage back, which
 * the event extractor's interface doesn't, because the run has to record what
 * enrichment cost.
 */

/** Two sentences of Polish is comfortably under this. The ceiling exists to
 *  bound the bill, not to shape the answer. */
const MAX_TOKENS = 300;

const SYSTEM = `You describe cultural events for a listings app.

You are given the readable text of a single event's page. Reply with exactly
two lines and nothing else:

CATEGORY: <one of: exhibition, guided_tour, workshop, screening, lecture, concert, performance, festival, other>
DESCRIPTION: <what the event IS — the play, film, concert or exhibition itself>

Rules:
- Answer the description in the same language as the page.
- At most 2 sentences, ideally 1.
- Describe the work, not the logistics. Never mention ticket prices, booking,
  opening hours, accessibility or the venue's address.
- If the page carries no description of the work, write: DESCRIPTION: NONE
- CATEGORY must be one of the listed values exactly. Use "other" if unsure.`;

export class AnthropicDescriber implements DescriptionClient {
  private client: Anthropic;

  constructor(apiKey: string, private readonly model: string = MODEL) {
    this.client = new Anthropic({ apiKey, maxRetries: 4 });
  }

  async describe({ text, url }: { text: string; url: string }): Promise<DescriptionResult> {
    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Page: ${url}\n\n${text}` }],
    });

    const raw = resp.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
      .trim();

    const parsed = parseReply(raw);
    return {
      description: parsed.description,
      // GOI-80 step 2: the classification rides along on this call rather than
      // costing a second one. `classifyEvent` ignores it whenever the keyword
      // pass already answered, so an unnecessary value here is harmless.
      category: parsed.category,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
    };
  }
}

/**
 * Split the two-line reply. Tolerant on purpose: a model that answers with
 * only a description still yields one, and a missing category simply leaves
 * the row to the keyword pass and the 'other' fallback.
 */
export function parseReply(raw: string): { description: string | null; category: string | null } {
  const category = raw.match(/^\s*CATEGORY:\s*(.+)$/im)?.[1]?.trim().toLowerCase() ?? null;
  const described = raw.match(/^\s*DESCRIPTION:\s*([\s\S]*)$/im)?.[1];
  // No labels at all — treat the whole reply as the description, which is what
  // the pre-GOI-80 prompt produced.
  const body = described ?? (category ? '' : raw);
  return { description: normalize(body), category: category || null };
}

/**
 * "NONE" is the model saying the page had nothing to describe, and an empty
 * answer means the same thing — both must become null rather than being stored
 * as the literal text. A page that genuinely has no description is a normal
 * outcome, not a failure.
 */
export function normalize(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ').trim().replace(/^["'“]|["'”]$/g, '');
  if (!text) return null;
  if (/^none\.?$/i.test(text)) return null;
  return text;
}

/** Null when the deployment has no key — enrichment then falls back to the
 *  page's own meta tags, which costs nothing and is often right. */
export function defaultDescriber(): DescriptionClient | null {
  return env.ANTHROPIC_API_KEY ? new AnthropicDescriber(env.ANTHROPIC_API_KEY) : null;
}

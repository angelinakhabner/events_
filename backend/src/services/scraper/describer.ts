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

const SYSTEM = `You write one-sentence descriptions of cultural events for a listings app.

You are given the readable text of a single event's page. Reply with a plain
description of what the event IS — the play, film, concert or exhibition
itself. No greeting, no preamble, no quotes, no markdown.

Rules:
- Answer in the same language as the page.
- At most 2 sentences, ideally 1.
- Describe the work, not the logistics. Never mention ticket prices, booking,
  opening hours, accessibility or the venue's address.
- If the page carries no description of the work, reply with exactly: NONE`;

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
      .join(' ')
      .trim();

    return {
      description: normalize(raw),
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
    };
  }
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

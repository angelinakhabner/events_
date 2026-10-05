import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config.js';
import { MODEL } from './extractor.js';
import type { DescribeInput, DescriptionClient, DescriptionResult } from './enricher.js';

/** Two sentences and a paragraph are comfortably under this even with a
 *  search's tool calls in the reply. The ceiling exists to bound the bill,
 *  not to shape the answer. */
const MAX_TOKENS = 2_000;

/** Searches one show may spend. One usually finds it; the second is for a
 *  title that needs the venue or the director beside it to disambiguate. */
const MAX_SEARCHES = 2;

/** `pause_turn` continuations before giving up on a show (it is retried next
 *  run, not lost). */
const MAX_CONTINUATIONS = 2;

const SYSTEM = `You write event descriptions for a Polish-language listings app about cultural life in Poland.

You are given what is known about one event: its title, the venue, the venue's own listing note, and usually the text of the event's page and the page's own summary from its metadata. For many venues you also get the venue's synopsis: the venue's own text about the work, taken from the event's page. These are usually in Polish, sometimes in English or another language.

Reply with exactly three lines and nothing else:

CATEGORY: <one of: exhibition, guided_tour, workshop, screening, lecture, concert, performance, festival, other>
DESCRIPTION: <in Polish: what the work itself is about, in 1-2 sentences>
LONG: <in Polish: one paragraph of 3-5 sentences about the work, on one line>

Rules:
- Always write both descriptions in Polish, whatever language the sources are in. Translate; never copy sentences in another language. Keep proper names (titles, people, places) as they are.
- Describe the work — what the film, play, concert or exhibition is about, and who made it. DESCRIPTION: at most 2 sentences, ideally 1.
- LONG goes further than DESCRIPTION, for a reader deciding whether to go: the premise or subject, the approach or form, who made it and who is in it, and what critics or the venue single out. Only what the sources say. If they say no more than DESCRIPTION does, write LONG: NONE rather than padding it.
- When a venue synopsis is given, base both descriptions on it; it is the venue's own account of the work. Use the page text only for names and credits it lacks. Do not search the web unless the synopsis is about something other than the work itself.
- Never describe logistics: the stage or room, subtitles or surtitles, the language it is performed in, ticket prices, discounts, booking, opening hours, accessibility, the address. "Spektakl na Dużej Scenie z angielskimi napisami" is not a description.
- If the material you were given does not say what the work is about, search the web for it (the title with the venue, or the work itself — a film's synopsis, a play's premise, an artist's show) and describe it from what you find. Use only results that are clearly about this same work.
- If you still cannot tell what it is about, write DESCRIPTION: NONE and LONG: NONE. Never invent.
- CATEGORY must be one of the listed values exactly. Use "other" if unsure.`;

/**
 * The server-side web search tool (GOI-131).
 *
 * Cast because the pinned SDK predates server tools in its types; the API
 * itself takes the block as written, and the rest of this file only ever
 * reads the reply's text blocks, which the old types do describe.
 */
const WEB_SEARCH = {
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: MAX_SEARCHES,
} as unknown as Anthropic.Tool;

/**
 * Writes one show's description (GOI-79, then GOI-130 / GOI-131), and the
 * longer paragraph the newsletter's "full" detail prints (GOI-139).
 *
 * Deliberately not the event extractor: that one is a forced tool call
 * returning an array of events with a dozen fields, sized for a whole listing
 * page. This reads one show and returns one or two sentences — in Polish,
 * about the work, searched for when the venue's own words do not say — and it
 * reports token usage back, because the run has to record what enrichment
 * cost.
 */
export class AnthropicDescriber implements DescriptionClient {
  private client: Anthropic;
  /** Flipped off for the life of the process by an account that rejects the
   *  tool (web search not enabled in the Console), so that is paid for once
   *  rather than as a failed request per show. */
  private searchAvailable = true;

  constructor(apiKey: string, private readonly model: string = MODEL) {
    this.client = new Anthropic({ apiKey, maxRetries: 4 });
  }

  async describe(input: DescribeInput): Promise<DescriptionResult> {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: describePrompt(input) }];
    let resp: Anthropic.Message;
    try {
      resp = await this.create(messages);
    } catch (e) {
      if (!(this.searchAvailable && e instanceof Anthropic.BadRequestError)) throw e;
      // Only blame the tool if the same request goes through without it; a
      // 400 about something else must not switch search off for the process.
      resp = await this.create(messages, false);
      console.warn(`[describer] web search rejected, describing from the page alone: ${e.message}`);
      this.searchAvailable = false;
    }

    let inputTokens = resp.usage.input_tokens;
    let outputTokens = resp.usage.output_tokens;
    let searched = usedSearch(resp);

    // A server-side tool loop that hits its iteration limit pauses; handing
    // the turn back resumes it where it stopped.
    for (let n = 0; (resp.stop_reason as string) === 'pause_turn' && n < MAX_CONTINUATIONS; n++) {
      messages.push({ role: 'assistant', content: resp.content });
      resp = await this.create(messages);
      inputTokens += resp.usage.input_tokens;
      outputTokens += resp.usage.output_tokens;
      searched ||= usedSearch(resp);
    }

    const raw = resp.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();

    const parsed = parseReply(raw);
    return {
      description: parsed.description,
      longDescription: parsed.longDescription,
      // GOI-80 step 2: the classification rides along on this call rather than
      // costing a second one. `classifyEvent` ignores it whenever the keyword
      // pass already answered, so an unnecessary value here is harmless.
      category: parsed.category,
      inputTokens,
      outputTokens,
      searched,
    };
  }

  private create(messages: Anthropic.MessageParam[], search = this.searchAvailable): Promise<Anthropic.Message> {
    return this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages,
      ...(search ? { tools: [WEB_SEARCH] } : {}),
    });
  }
}

/** The user turn: everything known about the show, labelled, blanks omitted. */
export function describePrompt(input: DescribeInput): string {
  const lines = [
    input.title ? `Title: ${input.title}` : null,
    input.venue ? `Venue: ${input.venue.name}, ${input.venue.city} (${input.venue.category})` : null,
    `Page: ${input.url}`,
    input.note?.trim() ? `Listing note: ${input.note.trim()}` : null,
    input.summary?.trim() ? `Page summary: ${input.summary.trim()}` : null,
  ].filter(Boolean);
  const synopsis = input.synopsis?.trim() ? `\n\nVenue synopsis:\n${input.synopsis.trim()}` : '';
  const page = input.text?.trim()
    ? `\n\nPage text:\n${input.text.trim()}`
    : '\n\n(No page text is available for this event.)';
  return lines.join('\n') + synopsis + page;
}

function usedSearch(resp: Anthropic.Message): boolean {
  return resp.content.some((b) => (b.type as string) === 'server_tool_use');
}

/**
 * Split the two-line reply. Tolerant on purpose: a model that answers with
 * only a description still yields one, and a missing category simply leaves
 * the row to the keyword pass and the 'other' fallback.
 */
export function parseReply(raw: string): {
  description: string | null;
  longDescription: string | null;
  category: string | null;
} {
  // Unanchored: with web search on, the reply's text blocks are joined as
  // they came, so a sentence the model wrote before searching can sit on the
  // same line as the first label.
  const category = raw.match(/CATEGORY:[ \t]*([a-z_]+)/i)?.[1]?.trim().toLowerCase() ?? null;
  // LONG is last, so DESCRIPTION runs up to it — or to the end of a reply
  // that has none (the pre-GOI-139 two-line shape).
  const longAt = raw.search(/\bLONG:/i);
  const head = longAt >= 0 ? raw.slice(0, longAt) : raw;
  const long = longAt >= 0 ? raw.slice(longAt).replace(/^LONG:/i, '') : '';
  const described = head.match(/DESCRIPTION:\s*([\s\S]*)$/i)?.[1];
  // No labels at all — treat the whole reply as the description, which is what
  // the pre-GOI-80 prompt produced.
  const body = described ?? (category ? '' : head);
  const description = normalize(body);
  return {
    description,
    // A paragraph about nothing is not one: no description, no long one.
    longDescription: description ? normalize(long) : null,
    category: category || null,
  };
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

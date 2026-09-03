import Anthropic from '@anthropic-ai/sdk';
import { jsonrepair } from 'jsonrepair';
import type { Venue } from '@afisz/shared';
import { env } from '../../config.js';

// Model choice: claude-sonnet-4-6 (latest Sonnet) — best price/accuracy balance
// for structured HTML extraction. Opus is overkill for this task; Haiku risks
// reliability on messy real-world venue HTML with Polish content and ambiguous
// date formats. Sonnet 4.6 handles structured extraction with high fidelity
// at a fraction of Opus cost.
//
// Overridable via EXTRACTOR_MODEL so a candidate can be trialled against the
// fixtures (`npm run compare:models`) without a code change; the default is
// still the Sonnet above.
export const MODEL = env.EXTRACTOR_MODEL;

/**
 * Model for pages whose input is *structured data* rather than messy HTML
 * (GOI-16).
 *
 * The reasoning above is about parsing real-world venue markup. It does not
 * apply when the preprocessor has already replaced the body with a JSON-LD or
 * `__NEXT_DATA__ ` payload — there the job is transcribing well-formed JSON
 * into well-formed JSON, with no date guessing and no layout to interpret.
 * Those pages plausibly need far less model than Sonnet.
 *
 * Unset by default, so behaviour is identical until somebody has actually
 * measured it — see `npm run compare:models`. Set EXTRACTOR_MODEL_STRUCTURED
 * to try e.g. claude-haiku-4-5-20251001 on that path alone, leaving every
 * HTML-parsing venue on Sonnet.
 */
export const STRUCTURED_MODEL = env.EXTRACTOR_MODEL_STRUCTURED;

/** Which model an extraction should use, given whether its input is structured. */
export function modelFor(structuredInput: boolean): string {
  return structuredInput && STRUCTURED_MODEL ? STRUCTURED_MODEL : MODEL;
}

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
// v8: two cost changes. (1) The unchanged-page fingerprint now hashes the
// *cleaned* preprocessor output instead of raw HTML, so per-request noise no
// longer forces daily re-extracts. (2) When a page has trustworthy structured
// data (JSON-LD events / __NEXT_DATA__), the preprocessor now drops the
// redundant HTML body and sends only the structured payload, cutting input
// tokens sharply. Both change what we hash, so bumping re-baselines every venue
// once on deploy.
// v9: rows now carry `kind` ('timed' | 'exhibition') and `ends_at` (GOI-67).
// Museums were being given a fabricated start hour because the schema had no
// way to say "runs 12 Jun – 14 Sep, no showtime". Every venue re-extracts once
// so exhibitions arrive with a real range instead of a midnight placeholder.
export const EXTRACTOR_VERSION = 9;

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
            kind: {
              type: 'string',
              enum: ['timed', 'exhibition'],
              description:
                '"exhibition" for a run over a date range with no clock time; "timed" for a screening/performance/workshop at a specific hour',
            },
            starts_at: {
              type: 'string',
              description:
                'ISO 8601 with timezone offset, e.g. "2026-06-08T18:00:00+02:00". For an exhibition, its opening date at 00:00 local time.',
            },
            ends_at: {
              type: ['string', 'null'],
              description:
                'Required for kind="exhibition": its closing date at 00:00 local time, ISO 8601 with offset. Null for kind="timed".',
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
            'kind',
            'starts_at',
            'ends_at',
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
  /** `model` lets a caller pick per-request (GOI-16). Implementations that
   *  carry their own model may ignore it; the batch coordinator forwards it. */
  extract(args: { system: string; user: string; model?: string }): Promise<string>;
}

class AnthropicExtractor implements ExtractorClient {
  private client: Anthropic;
  private model: string;
  constructor(apiKey: string, model: string = MODEL) {
    this.model = model;
    // maxRetries: 6 lets the SDK honour Anthropic's `retry-after` header for
    // 429 / 5xx (default is 2, which loses scrapes when a same-minute burst
    // pushes us past the 30k input-tokens/minute org cap). With backoff the
    // worst case adds a few minutes to the daily sweep — acceptable for cron.
    this.client = new Anthropic({ apiKey, maxRetries: 6 });
  }
  async extract({ system, user, model }: { system: string; user: string; model?: string }): Promise<string> {
    // Stream and assemble the final message: at MAX_TOKENS this large a
    // non-streaming request risks an SDK HTTP timeout before the body lands.
    const resp = await this.client.messages
      .stream({
        model: model ?? this.model,
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

/** One venue's extraction request inside a batch submission. */
export interface BatchExtractRequest {
  /** Venue id. Echoed back by the API so results can be re-keyed to venues. */
  customId: string;
  system: string;
  user: string;
  /** Per-request model, so one batch can mix Sonnet (HTML venues) with a
   *  cheaper model on the structured-data path (GOI-16). Defaults to MODEL. */
  model?: string;
}

/** Per-request outcome. Failures are per-venue: one bad page must not sink the sweep. */
export type BatchExtractOutcome =
  | { ok: true; json: string }
  | { ok: false; error: string };

export interface BatchExtractorClient {
  run(requests: BatchExtractRequest[]): Promise<Map<string, BatchExtractOutcome>>;
}

export interface BatchPollOptions {
  /** Delay between status polls. */
  pollIntervalMs?: number;
  /** Give up (and cancel the batch) after this long. */
  maxWaitMs?: number;
  /** Injectable sleep/clock so tests don't wait in real time. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Injectable SDK client, for tests. */
  client?: Anthropic;
}

/** Most batches land well inside an hour; the API's own ceiling is 24h. */
export const DEFAULT_BATCH_POLL_INTERVAL_MS = 30_000;
export const DEFAULT_BATCH_MAX_WAIT_MS = 6 * 60 * 60_000;

/**
 * Message Batches implementation: submits every venue's prompt as one batch,
 * polls to completion, and re-keys results by venue id. Costs 50% of the
 * standard per-token price, and batch requests don't draw on the per-minute
 * rate limits the inline path has to pace itself around.
 */
export class AnthropicBatchExtractor implements BatchExtractorClient {
  private client: Anthropic;
  private opts: BatchPollOptions;

  constructor(apiKey: string, opts: BatchPollOptions = {}) {
    this.client = opts.client ?? new Anthropic({ apiKey, maxRetries: 6 });
    this.opts = opts;
  }

  async run(requests: BatchExtractRequest[]): Promise<Map<string, BatchExtractOutcome>> {
    const out = new Map<string, BatchExtractOutcome>();
    if (requests.length === 0) return out;

    const pollIntervalMs = this.opts.pollIntervalMs ?? DEFAULT_BATCH_POLL_INTERVAL_MS;
    const maxWaitMs = this.opts.maxWaitMs ?? DEFAULT_BATCH_MAX_WAIT_MS;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const now = this.opts.now ?? Date.now;

    const batch = await this.client.beta.messages.batches.create({
      requests: requests.map((r) => ({
        custom_id: r.customId,
        params: {
          model: r.model ?? MODEL,
          max_tokens: MAX_TOKENS,
          system: r.system,
          tools: [EVENT_TOOL],
          // Force the call so the model can't answer in prose and skip the tool.
          tool_choice: { type: 'tool' as const, name: EVENT_TOOL.name },
          messages: [{ role: 'user' as const, content: r.user }],
        },
      })),
    });
    console.log(`[batch] submitted ${requests.length} request(s) as ${batch.id}`);

    const startedAt = now();
    for (;;) {
      const status = await this.client.beta.messages.batches.retrieve(batch.id);
      if (status.processing_status === 'ended') break;
      if (now() - startedAt > maxWaitMs) {
        // Cancel so in-flight requests stop billing, then fail every venue —
        // the next sweep retries them from scratch.
        await this.client.beta.messages.batches.cancel(batch.id).catch(() => {});
        throw new Error(
          `Batch ${batch.id} still ${status.processing_status} after ${Math.round(maxWaitMs / 60_000)}m; cancelled`,
        );
      }
      await sleep(pollIntervalMs);
    }

    for await (const result of await this.client.beta.messages.batches.results(batch.id)) {
      const id = result.custom_id;
      switch (result.result.type) {
        case 'succeeded':
          try {
            out.set(id, { ok: true, json: toolResponseToJson(result.result.message as Anthropic.Message) });
          } catch (e) {
            out.set(id, { ok: false, error: e instanceof Error ? e.message : String(e) });
          }
          break;
        case 'errored':
          out.set(id, { ok: false, error: `batch request errored: ${JSON.stringify(result.result.error)}` });
          break;
        case 'canceled':
          out.set(id, { ok: false, error: 'batch request was canceled' });
          break;
        case 'expired':
          out.set(id, { ok: false, error: 'batch request expired before processing (24h limit)' });
          break;
      }
    }
    return out;
  }
}

let _defaultBatchClient: BatchExtractorClient | null = null;
export function defaultBatchClient(opts: BatchPollOptions = {}): BatchExtractorClient {
  if (!_defaultBatchClient) {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    _defaultBatchClient = new AnthropicBatchExtractor(env.ANTHROPIC_API_KEY, opts);
  }
  return _defaultBatchClient;
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

// Cached per model, so a sweep mixing Sonnet (HTML venues) and a cheaper
// model (structured venues) doesn't rebuild an SDK client per request.
const _defaultClients = new Map<string, ExtractorClient>();
function defaultClient(model: string = MODEL): ExtractorClient {
  let client = _defaultClients.get(model);
  if (!client) {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    client = new AnthropicExtractor(env.ANTHROPIC_API_KEY, model);
    _defaultClients.set(model, client);
  }
  return client;
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

/**
 * Whether a category's listings go stale faster than a weekly sweep can keep
 * up (GOI-107).
 *
 * The window above is not just how far ahead we *look* — it is how far ahead
 * the source can be read at all. A Warsaw cinema publishes one week at a time,
 * Friday to Thursday, and puts the next week up mid-week: Kino Muranów's
 * calendar, read on a Tuesday, carries a full sixteen screenings for Wednesday
 * and two for the Friday after. Everything past the current week is the
 * handful of advance-sale specials.
 *
 * A weekly sweep therefore cannot see a cinema's new week at all until its
 * next turn comes round, and by then that week is half over. The app spends
 * days showing two or three screenings for a day the cinema is showing a dozen
 * on, which is exactly what GOI-107 reports. It is not an extraction failure —
 * the parser takes every row the page carries — it is a sweep that looks once
 * a week at a page that is only ever a week long.
 *
 * So a category whose horizon does not comfortably outlast the gap between
 * sweeps is swept daily regardless of the weekly setting. Stated against the
 * window rather than as a list of categories: the rule is about the shape of
 * the source, and a new short-horizon category should inherit it without
 * anyone remembering to.
 */
export function needsDailySweep(category: string | undefined): boolean {
  return windowDaysForCategory(category) <= DAYS_PER_WEEK;
}

const DAYS_PER_WEEK = 7;

export interface ExtractOptions {
  client?: ExtractorClient;
  hint?: string | null;
  /** Override the category-derived horizon (days from `today`). */
  windowDays?: number;
  /** Override the extraction model for this call (GOI-16). Forwarded to an
   *  injected `client` too, so the batched path honours it. */
  model?: string;
}

/**
 * Build the exact (system, user) pair we send for a venue. Pure — no network —
 * so the same prompt can either be issued inline (one request, answer comes
 * back immediately) or packed into a Message Batches submission at half the
 * token price. `extractEvents` below is the inline path.
 */
export function buildExtractionPrompt(
  cleanedHtml: string,
  venue: Pick<Venue, 'name' | 'city' | 'timezone' | 'category' | 'url'>,
  today: Date,
  opts: Pick<ExtractOptions, 'hint' | 'windowDays'> = {},
): { system: string; user: string } {
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
  "kind": "timed" | "exhibition" (see KIND below),
  "starts_at": string (ISO 8601 WITH timezone offset, e.g. "2026-06-08T18:00:00+02:00"),
  "ends_at": string | null (ISO 8601 with offset; required for "exhibition", null for "timed"),
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

KIND — a museum page lists two different things; label each row:
- "exhibition": the source shows a DATE RANGE and no clock time (e.g. "12.06 – 14.09", "do 14 września", "od 12 czerwca do 14 września"). Set starts_at to the opening date at 00:00 local time and ends_at to the closing date at 00:00 local time. NEVER invent a start_time for one.
- "timed": the source shows a specific hour for that item (a screening, a performance, a 17:30 workshop, an 11:00 guided tour). Set ends_at to null.
- If an item's time is ambiguous or missing and it is not obviously a single dated occurrence, emit "exhibition" rather than guessing an hour.
- An exhibition with no printed closing date cannot be recorded — omit it rather than inventing one.
- Everything at a cinema, theatre, comedy club or concert hall is "timed". Only galleries and museums list exhibitions.

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
  00:00 / midnight as a placeholder. (Exception: kind="exhibition", whose
  starts_at/ends_at are dates at 00:00 by construction.)
- An exhibition currently on display counts even though it opened before today:
  emit it with its real opening date in starts_at, not today's date.
- Year defaults to ${year} unless stated.
- Polish dates are common (e.g. "8 czerwca", "dziś", "jutro") — resolve them relative to today's date.
- Call the record_events tool exactly once with every event in its events array. Do not write any prose.

HTML:
${cleanedHtml}`;

  return { system: SYSTEM_PROMPT, user };
}

export async function extractEvents(
  cleanedHtml: string,
  venue: Pick<Venue, 'name' | 'city' | 'timezone' | 'category' | 'url'>,
  today: Date,
  opts: ExtractOptions = {},
): Promise<unknown[]> {
  const client = opts.client ?? defaultClient(opts.model);
  const { system, user } = buildExtractionPrompt(cleanedHtml, venue, today, opts);
  const text = await client.extract({ system, user, model: opts.model });
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

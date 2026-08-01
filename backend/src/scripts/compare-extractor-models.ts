import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config.js';
import { DEFAULT_VENUES } from '../data/default-venues.js';
import { preprocessForVenue, isDeterministicallyParsable } from '../services/scraper/preprocessor.js';
import { buildExtractionPrompt, MODEL, parseJsonArray } from '../services/scraper/extractor.js';
import { validateEvents } from '../services/scraper/validator.js';

/**
 * GOI-16 — measure a cheaper model against the one in production, on the venue
 * class where it plausibly suffices: pages whose input is *structured data*
 * (JSON-LD / __NEXT_DATA__) rather than markup to interpret.
 *
 *   npm run compare:models --workspace backend -- <fixture.html> <venue-slug> [modelA] [modelB]
 *
 * Runs the byte-identical prompt the scraper would send through each model and
 * reports, per model: rows extracted, rows surviving the validator, token
 * counts, wall time, and — the part that actually decides it — a field-level
 * diff against the first model's output.
 *
 * Deliberately offline-capable input: it reads a saved fixture rather than
 * fetching the venue, so a comparison is repeatable and re-runnable on the
 * same bytes. Needs ANTHROPIC_API_KEY; costs real tokens.
 */

const MAX_TOKENS = 48_000;

interface Run {
  model: string;
  rows: Record<string, unknown>[];
  validCount: number;
  invalidCount: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  error?: string;
}

async function runModel(
  model: string,
  prompt: { system: string; user: string },
  venue: (typeof DEFAULT_VENUES)[number],
): Promise<Run> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY!, maxRetries: 6 });
  const startedAt = Date.now();
  const base: Run = {
    model, rows: [], validCount: 0, invalidCount: 0, inputTokens: 0, outputTokens: 0, ms: 0,
  };
  try {
    const resp = await client.messages
      .stream({
        model,
        max_tokens: MAX_TOKENS,
        system: prompt.system,
        tools: [eventTool()],
        tool_choice: { type: 'tool', name: 'record_events' },
        messages: [{ role: 'user', content: prompt.user }],
      })
      .finalMessage();

    const block = resp.content.find((c) => c.type === 'tool_use');
    const rows = block
      ? ((block.input as { events?: Record<string, unknown>[] }).events ?? [])
      : (parseJsonArray(resp.content.map((c) => (c.type === 'text' ? c.text : '')).join('')) as Record<string, unknown>[]);
    const { valid, invalid } = validateEvents(rows, {
      category: venue.category,
      timezone: venue.timezone,
    });
    return {
      ...base,
      rows,
      validCount: valid.length,
      invalidCount: invalid.length,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      ms: Date.now() - startedAt,
    };
  } catch (e) {
    return { ...base, ms: Date.now() - startedAt, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The extractor's tool schema. Imported shape would be private, so mirror the
 *  one field that matters here — the models must answer the same way. */
function eventTool(): Anthropic.Tool {
  return {
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
              starts_at: { type: 'string', description: 'ISO 8601 with timezone offset' },
              duration_minutes: { type: ['integer', 'null'] },
              language: { type: ['string', 'null'] },
              director: { type: ['string', 'null'] },
              cast: { type: ['array', 'null'], items: { type: 'string' } },
              description: { type: ['string', 'null'] },
              price_min: { type: ['integer', 'null'] },
              price_max: { type: ['integer', 'null'] },
              source_url: { type: 'string' },
              source_id: { type: ['string', 'null'] },
            },
            required: [
              'title', 'starts_at', 'duration_minutes', 'language', 'director', 'cast',
              'description', 'price_min', 'price_max', 'source_url', 'source_id',
            ],
          },
        },
      },
      required: ['events'],
    },
  };
}

/** Key a row by the two fields that identify an event; everything else is
 *  compared field by field within a match. */
const keyOf = (r: Record<string, unknown>) =>
  `${String(r.title ?? '').trim().toLowerCase()}@${String(r.starts_at ?? '')}`;

const FIELDS = [
  'duration_minutes', 'language', 'director', 'cast',
  'description', 'price_min', 'price_max', 'source_url', 'source_id',
] as const;

function diff(baseline: Run, candidate: Run): string[] {
  const out: string[] = [];
  const a = new Map(baseline.rows.map((r) => [keyOf(r), r]));
  const b = new Map(candidate.rows.map((r) => [keyOf(r), r]));

  const missing = [...a.keys()].filter((k) => !b.has(k));
  const extra = [...b.keys()].filter((k) => !a.has(k));
  // Events present in one and not the other are the failure that matters —
  // a missing screening is a screening the reader never hears about.
  if (missing.length) out.push(`  ${missing.length} event(s) only in ${baseline.model}:`);
  for (const k of missing.slice(0, 10)) out.push(`    − ${k}`);
  if (extra.length) out.push(`  ${extra.length} event(s) only in ${candidate.model}:`);
  for (const k of extra.slice(0, 10)) out.push(`    + ${k}`);

  const fieldDiffs = new Map<string, number>();
  for (const [k, rowA] of a) {
    const rowB = b.get(k);
    if (!rowB) continue;
    for (const f of FIELDS) {
      if (JSON.stringify(rowA[f]) !== JSON.stringify(rowB[f])) {
        fieldDiffs.set(f, (fieldDiffs.get(f) ?? 0) + 1);
      }
    }
  }
  const matched = [...a.keys()].filter((k) => b.has(k)).length;
  if (fieldDiffs.size) {
    out.push(`  field differences across ${matched} matched event(s):`);
    for (const [f, n] of [...fieldDiffs].sort((x, y) => y[1] - x[1])) {
      out.push(`    ${f}: ${n}`);
    }
  } else if (matched) {
    out.push(`  ${matched} matched event(s), every compared field identical`);
  }
  return out;
}

async function main(): Promise<void> {
  const [fixturePath, venueSlug, ...models] = process.argv.slice(2);
  if (!fixturePath || !venueSlug) {
    console.error(
      'Usage: compare:models <fixture.html> <venue-slug> [modelA] [modelB ...]\n' +
      '  e.g. compare:models backend/test/fixtures/powszechny.com-api-repertoire-lang-pl.html teatr-powszechny \\\n' +
      '         claude-sonnet-4-6 claude-haiku-4-5-20251001',
    );
    process.exit(2);
  }
  if (!env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — this script makes real API calls.');
    process.exit(2);
  }

  const venue = DEFAULT_VENUES.find((v) => v.id === venueSlug);
  if (!venue) {
    console.error(`No default venue with id "${venueSlug}". Known: ${DEFAULT_VENUES.map((v) => v.id).join(', ')}`);
    process.exit(1);
  }

  const html = await readFile(fixturePath, 'utf8');
  const { cleaned, hint, structured } = preprocessForVenue(html, venue);
  const isStructured = isDeterministicallyParsable(structured);
  const today = new Date();
  const prompt = buildExtractionPrompt(cleaned, venue, today, { hint });

  const chosen = models.length >= 2 ? models : [MODEL, 'claude-haiku-4-5-20251001'];

  console.log(`venue:      ${venue.name} (${venue.id}, ${venue.category})`);
  console.log(`fixture:    ${fixturePath}`);
  console.log(`input:      ${isStructured ? 'STRUCTURED (json payload only)' : 'HTML'}, ${cleaned.length} chars`);
  console.log(`models:     ${chosen.join(', ')}\n`);
  if (!isStructured) {
    console.log(
      'NOTE: this fixture is not on the structured-data path, so it measures the\n' +
      '      harder HTML-parsing job rather than the one GOI-16 asks about.\n',
    );
  }

  // Sequential, not parallel: the org's per-minute input-token cap is shared,
  // and a burst would have the second model retrying rather than answering.
  const runs: Run[] = [];
  for (const model of chosen) {
    process.stdout.write(`running ${model}... `);
    const run = await runModel(model, prompt, venue);
    runs.push(run);
    console.log(run.error ? `FAILED: ${run.error}` : `${run.rows.length} rows in ${run.ms}ms`);
  }

  console.log('\n' + 'model'.padEnd(32) + 'rows  valid  invalid   in-tok   out-tok      ms');
  for (const r of runs) {
    console.log(
      r.model.padEnd(32) +
      String(r.rows.length).padStart(4) +
      String(r.validCount).padStart(7) +
      String(r.invalidCount).padStart(9) +
      String(r.inputTokens).padStart(9) +
      String(r.outputTokens).padStart(10) +
      String(r.ms).padStart(8),
    );
  }

  const baseline = runs[0]!;
  for (const candidate of runs.slice(1)) {
    console.log(`\n${candidate.model} vs ${baseline.model}:`);
    if (baseline.error || candidate.error) {
      console.log('  skipped — one of the runs failed');
      continue;
    }
    for (const line of diff(baseline, candidate)) console.log(line);
  }

  console.log(
    '\nA candidate is only worth adopting if it loses no events and its field\n' +
    'differences are ones you would accept — then set EXTRACTOR_MODEL_STRUCTURED.',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

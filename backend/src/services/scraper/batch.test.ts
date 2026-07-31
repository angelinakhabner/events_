import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ScrapeRun } from '@afisz/shared';
import { Gate, scrapeVenuesBatched } from './batch.js';
import {
  AnthropicBatchExtractor,
  type BatchExtractOutcome,
  type BatchExtractRequest,
  type BatchExtractorClient,
} from './extractor.js';
import type { ScrapeOptions } from './runner.js';

/** Records every batch submission so tests can assert how many were made. */
class FakeBatchClient implements BatchExtractorClient {
  readonly calls: BatchExtractRequest[][] = [];
  constructor(
    private readonly responder: (r: BatchExtractRequest) => BatchExtractOutcome = (r) => ({
      ok: true,
      json: JSON.stringify([{ title: r.customId }]),
    }),
  ) {}

  async run(requests: BatchExtractRequest[]): Promise<Map<string, BatchExtractOutcome>> {
    this.calls.push(requests);
    const out = new Map<string, BatchExtractOutcome>();
    for (const r of requests) out.set(r.customId, this.responder(r));
    return out;
  }
}

/** Always-throwing client, for the "submission itself failed" path. */
class ExplodingBatchClient implements BatchExtractorClient {
  constructor(private readonly message: string) {}
  async run(): Promise<Map<string, BatchExtractOutcome>> {
    throw new Error(this.message);
  }
}

function run(venueId: string, patch: Partial<ScrapeRun> = {}): ScrapeRun {
  return {
    id: venueId,
    venueId,
    startedAt: '2026-07-27T00:00:00.000Z',
    finishedAt: null,
    status: 'success',
    eventsFound: 0,
    errorMessage: null,
    rawHash: null,
    ...patch,
  };
}

/**
 * Stand-in for the real runner. `needsLlm: false` models a deterministic /
 * unchanged / JSON-LD venue, which never touches the extractor.
 */
function fakeScrape(spec: Record<string, { needsLlm: boolean; delayMs?: number }>) {
  return async (venueId: string, opts: ScrapeOptions): Promise<ScrapeRun> => {
    const behaviour = spec[venueId];
    if (!behaviour) throw new Error(`no behaviour for ${venueId}`);
    if (behaviour.delayMs) await new Promise((r) => setTimeout(r, behaviour.delayMs));
    if (!behaviour.needsLlm) return run(venueId, { status: 'skipped_unchanged' });

    try {
      const json = await opts.extractor!.extract({ system: 'sys', user: `user:${venueId}` });
      const events = JSON.parse(json) as unknown[];
      return run(venueId, { status: 'success', eventsFound: events.length });
    } catch (e) {
      // Mirrors the real runner, which catches and records a failed run.
      return run(venueId, {
        status: 'failed',
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  };
}

describe('Gate', () => {
  it('caps concurrent holders at the limit', async () => {
    const gate = new Gate(2);
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 6 }, async () => {
        await gate.acquire();
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        gate.release();
      }),
    );

    expect(peak).toBe(2);
  });

  it('hands a released slot to the longest waiter rather than over-admitting', async () => {
    const gate = new Gate(1);
    await gate.acquire();

    let secondEntered = false;
    const second = gate.acquire().then(() => {
      secondEntered = true;
    });

    expect(secondEntered).toBe(false);
    gate.release();
    await second;
    expect(secondEntered).toBe(true);
  });
});

describe('scrapeVenuesBatched', () => {
  it('collapses every LLM venue into a single batch submission', async () => {
    const client = new FakeBatchClient();
    const venues = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ];
    const runs: ScrapeRun[] = [];

    await scrapeVenuesBatched(venues, {
      client,
      scrape: fakeScrape({
        a: { needsLlm: true },
        b: { needsLlm: true },
        c: { needsLlm: true },
      }),
      onResult: (_v, r) => runs.push(r),
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.map((r) => r.customId).sort()).toEqual(['a', 'b', 'c']);
    expect(runs.every((r) => r.status === 'success')).toBe(true);
  });

  it('batches together even when fetch concurrency is 1', async () => {
    // The critical deadlock case: a parked venue must give up its slot so the
    // venues behind it can fetch and join the same batch.
    const client = new FakeBatchClient();
    const venues = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ];

    await scrapeVenuesBatched(venues, {
      client,
      concurrency: 1,
      scrape: fakeScrape({
        a: { needsLlm: true },
        b: { needsLlm: true },
        c: { needsLlm: true },
      }),
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toHaveLength(3);
  });

  it('excludes venues that never call the extractor, and they do not hold up the flush', async () => {
    const client = new FakeBatchClient();
    const venues = [
      { id: 'llm1', name: 'LLM 1' },
      { id: 'det1', name: 'Deterministic 1' },
      { id: 'llm2', name: 'LLM 2' },
      { id: 'det2', name: 'Deterministic 2' },
    ];
    const byVenue = new Map<string, ScrapeRun>();

    await scrapeVenuesBatched(venues, {
      client,
      scrape: fakeScrape({
        llm1: { needsLlm: true },
        // Deterministic venues take longer than the LLM ones reach parking,
        // so the coordinator must wait for them before deciding to flush.
        det1: { needsLlm: false, delayMs: 20 },
        llm2: { needsLlm: true },
        det2: { needsLlm: false, delayMs: 30 },
      }),
      onResult: (v, r) => byVenue.set(v.id, r),
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.map((r) => r.customId).sort()).toEqual(['llm1', 'llm2']);
    expect(byVenue.get('det1')!.status).toBe('skipped_unchanged');
    expect(byVenue.get('llm1')!.status).toBe('success');
  });

  it('fails only the venue whose batch entry errored', async () => {
    const client = new FakeBatchClient((r) =>
      r.customId === 'bad'
        ? { ok: false, error: 'batch request expired before processing (24h limit)' }
        : { ok: true, json: JSON.stringify([{ title: r.customId }]) },
    );
    const byVenue = new Map<string, ScrapeRun>();

    await scrapeVenuesBatched(
      [
        { id: 'good', name: 'Good' },
        { id: 'bad', name: 'Bad' },
      ],
      {
        client,
        scrape: fakeScrape({ good: { needsLlm: true }, bad: { needsLlm: true } }),
        onResult: (v, r) => byVenue.set(v.id, r),
      },
    );

    expect(byVenue.get('good')!.status).toBe('success');
    expect(byVenue.get('bad')!.status).toBe('failed');
    expect(byVenue.get('bad')!.errorMessage).toContain('expired');
  });

  it('fails every venue when the submission itself throws', async () => {
    const byVenue = new Map<string, ScrapeRun>();

    await scrapeVenuesBatched(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      {
        client: new ExplodingBatchClient('You have reached your specified API usage limits.'),
        scrape: fakeScrape({ a: { needsLlm: true }, b: { needsLlm: true } }),
        onResult: (v, r) => byVenue.set(v.id, r),
      },
    );

    for (const id of ['a', 'b']) {
      expect(byVenue.get(id)!.status).toBe('failed');
      expect(byVenue.get(id)!.errorMessage).toContain('usage limits');
    }
  });

  it('flushes parked venues on the safety timeout when one venue hangs', async () => {
    const client = new FakeBatchClient();
    const byVenue = new Map<string, ScrapeRun>();

    await scrapeVenuesBatched(
      [
        { id: 'fast', name: 'Fast' },
        { id: 'slow', name: 'Slow' },
      ],
      {
        client,
        // 'slow' spends far longer fetching than the flush timeout allows, so
        // 'fast' must not wait for it — it goes out in its own batch.
        scrape: fakeScrape({ fast: { needsLlm: true }, slow: { needsLlm: true, delayMs: 120 } }),
        concurrency: 2,
        flushTimeoutMs: 20,
        onResult: (v, r) => byVenue.set(v.id, r),
      },
    );

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]!.map((r) => r.customId)).toEqual(['fast']);
    expect(client.calls[1]!.map((r) => r.customId)).toEqual(['slow']);
    expect(byVenue.get('fast')!.status).toBe('success');
    expect(byVenue.get('slow')!.status).toBe('success');
  });

  it('does no work and submits nothing for an empty venue list', async () => {
    const client = new FakeBatchClient();
    await scrapeVenuesBatched([], { client });
    expect(client.calls).toHaveLength(0);
  });
});

/** Minimal stub of the SDK surface AnthropicBatchExtractor actually touches. */
function stubSdk(opts: {
  statuses: Array<'in_progress' | 'ended'>;
  results: Array<{ custom_id: string; result: unknown }>;
  onCancel?: () => void;
}) {
  let retrieveCount = 0;
  const created: unknown[] = [];
  return {
    created,
    retrieveCount: () => retrieveCount,
    sdk: {
      beta: {
        messages: {
          batches: {
            create: async (body: unknown) => {
              created.push(body);
              return { id: 'msgbatch_test' };
            },
            retrieve: async () => {
              const status = opts.statuses[Math.min(retrieveCount, opts.statuses.length - 1)]!;
              retrieveCount++;
              return { processing_status: status };
            },
            cancel: async () => {
              opts.onCancel?.();
              return {};
            },
            results: async () => opts.results,
          },
        },
      },
    } as unknown as Anthropic,
  };
}

function toolMessage(events: unknown[]) {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'record_events', input: { events } }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

describe('AnthropicBatchExtractor', () => {
  it('submits one request per venue and re-keys results by custom_id', async () => {
    const { sdk, created } = stubSdk({
      statuses: ['ended'],
      results: [
        { custom_id: 'venue-b', result: { type: 'succeeded', message: toolMessage([{ title: 'B' }]) } },
        { custom_id: 'venue-a', result: { type: 'succeeded', message: toolMessage([{ title: 'A' }]) } },
      ],
    });

    const extractor = new AnthropicBatchExtractor('key', { client: sdk, sleep: async () => {} });
    const out = await extractor.run([
      { customId: 'venue-a', system: 's', user: 'a' },
      { customId: 'venue-b', system: 's', user: 'b' },
    ]);

    const body = created[0] as { requests: Array<{ custom_id: string; params: { model: string } }> };
    expect(body.requests.map((r) => r.custom_id)).toEqual(['venue-a', 'venue-b']);
    // Results come back out of order — matching must be by custom_id, not index.
    expect(out.get('venue-a')).toEqual({ ok: true, json: JSON.stringify([{ title: 'A' }]) });
    expect(out.get('venue-b')).toEqual({ ok: true, json: JSON.stringify([{ title: 'B' }]) });
  });

  it('polls until the batch ends', async () => {
    const { sdk, retrieveCount } = stubSdk({
      statuses: ['in_progress', 'in_progress', 'ended'],
      results: [{ custom_id: 'v', result: { type: 'succeeded', message: toolMessage([]) } }],
    });

    const extractor = new AnthropicBatchExtractor('key', { client: sdk, sleep: async () => {} });
    await extractor.run([{ customId: 'v', system: 's', user: 'u' }]);

    expect(retrieveCount()).toBe(3);
  });

  it('maps each non-success result type to a per-venue error', async () => {
    const { sdk } = stubSdk({
      statuses: ['ended'],
      results: [
        { custom_id: 'errored', result: { type: 'errored', error: { type: 'invalid_request_error' } } },
        { custom_id: 'canceled', result: { type: 'canceled' } },
        { custom_id: 'expired', result: { type: 'expired' } },
      ],
    });

    const extractor = new AnthropicBatchExtractor('key', { client: sdk, sleep: async () => {} });
    const out = await extractor.run([
      { customId: 'errored', system: 's', user: 'u' },
      { customId: 'canceled', system: 's', user: 'u' },
      { customId: 'expired', system: 's', user: 'u' },
    ]);

    expect(out.get('errored')).toMatchObject({ ok: false });
    expect((out.get('errored') as { error: string }).error).toContain('invalid_request_error');
    expect((out.get('canceled') as { error: string }).error).toContain('canceled');
    expect((out.get('expired') as { error: string }).error).toContain('expired');
  });

  it('cancels and throws when the batch outlives maxWaitMs', async () => {
    let cancelled = false;
    let clock = 0;
    const { sdk } = stubSdk({
      statuses: ['in_progress'],
      results: [],
      onCancel: () => {
        cancelled = true;
      },
    });

    const extractor = new AnthropicBatchExtractor('key', {
      client: sdk,
      maxWaitMs: 1000,
      sleep: async () => {
        clock += 600;
      },
      now: () => clock,
    });

    await expect(extractor.run([{ customId: 'v', system: 's', user: 'u' }])).rejects.toThrow(
      /did not|still in_progress|cancelled/i,
    );
    expect(cancelled).toBe(true);
  });

  it('submits nothing for an empty request list', async () => {
    const { sdk, created } = stubSdk({ statuses: ['ended'], results: [] });
    const extractor = new AnthropicBatchExtractor('key', { client: sdk });
    expect((await extractor.run([])).size).toBe(0);
    expect(created).toHaveLength(0);
  });
});

import type { ScrapeRun } from '@goin/shared';
import { scrapeVenue, type ScrapeOptions } from './runner.js';
import type { BatchExtractorClient, ExtractorClient } from './extractor.js';

/**
 * Batched sweep: every venue that needs the LLM has its prompt parked instead
 * of sent, and once no venue is still working we submit them all as one
 * Message Batches request — half price per token, and no contention with the
 * per-minute rate limits that forced the inline path to sleep 65s between
 * venues.
 *
 * `scrapeVenue` is untouched: it already takes an injectable `ExtractorClient`,
 * so the parking happens entirely inside that seam. Deterministic venues,
 * unchanged pages, and JSON-LD venues never call `extract()` at all and so
 * never join a batch.
 */

/**
 * Concurrency limiter that a parked task can step out of. Fetching (Firecrawl
 * renders) is the resource worth pacing; a venue waiting on the batch is doing
 * nothing, so it releases its slot and re-acquires once results land. Without
 * the release, slots held by parked venues would starve the venues that
 * haven't fetched yet and the batch could never reach the whole set.
 */
export class Gate {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    // Hand the slot straight to a waiter rather than decrementing — otherwise
    // a release/acquire pair could let the active count drift above the limit.
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }
}

interface Parked {
  system: string;
  user: string;
  resolve: (json: string) => void;
  reject: (err: Error) => void;
}

export interface CoordinatorOptions {
  /**
   * Safety valve. If a venue hangs (a Firecrawl render that never returns),
   * the "everyone is parked" condition would never be met and the venues that
   * did arrive would wait forever. Flush what we have this long after the
   * first venue parks. Splitting into two batches costs nothing — the 50%
   * discount is per request, not per batch.
   */
  flushTimeoutMs?: number;
  onFlush?: (count: number) => void;
}

export const DEFAULT_FLUSH_TIMEOUT_MS = 10 * 60_000;

export class BatchExtractionCoordinator {
  private readonly parked = new Map<string, Parked>();
  private unsettled: number;
  private flushing = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    taskCount: number,
    private readonly client: BatchExtractorClient,
    private readonly opts: CoordinatorOptions = {},
  ) {
    this.unsettled = taskCount;
  }

  /** An `ExtractorClient` that parks the prompt instead of sending it. */
  clientFor(customId: string, gate?: Gate): ExtractorClient {
    return {
      extract: async ({ system, user }) => {
        gate?.release();
        try {
          return await new Promise<string>((resolve, reject) => {
            if (this.parked.has(customId)) {
              reject(new Error(`extract() called twice for ${customId}`));
              return;
            }
            this.parked.set(customId, { system, user, resolve, reject });
            this.armTimeout();
            void this.maybeFlush();
          });
        } finally {
          await gate?.acquire();
        }
      },
    };
  }

  /** Called when a venue's scrape finishes, successfully or not. */
  taskSettled(): void {
    this.unsettled = Math.max(0, this.unsettled - 1);
    void this.maybeFlush();
  }

  private armTimeout(): void {
    const ms = this.opts.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
    if (this.timer || ms <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Flush once every still-running venue is parked — nobody else is coming. */
  private async maybeFlush(): Promise<void> {
    if (this.flushing) return;
    if (this.parked.size === 0) return;
    if (this.parked.size < this.unsettled) return;
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.parked.size === 0) return;
    this.flushing = true;
    this.clearTimer();

    const batch = [...this.parked.entries()];
    this.parked.clear();
    this.opts.onFlush?.(batch.length);

    try {
      const results = await this.client.run(
        batch.map(([customId, p]) => ({ customId, system: p.system, user: p.user })),
      );
      for (const [customId, p] of batch) {
        const result = results.get(customId);
        if (!result) {
          p.reject(new Error(`batch returned no result for ${customId}`));
        } else if (result.ok) {
          p.resolve(result.json);
        } else {
          p.reject(new Error(result.error));
        }
      }
    } catch (e) {
      // Submission itself failed (auth, usage cap, network). Fail every venue
      // in the batch with the same message so each records its own failed run.
      const err = e instanceof Error ? e : new Error(String(e));
      for (const [, p] of batch) p.reject(err);
    } finally {
      this.flushing = false;
      // A venue may have parked while the batch was in flight (timeout path).
      void this.maybeFlush();
    }
  }
}

export interface BatchedSweepOptions {
  client: BatchExtractorClient;
  /** Parallel fetches. Parked venues don't hold a slot. */
  concurrency?: number;
  flushTimeoutMs?: number;
  /** Injectable for tests. */
  scrape?: (venueId: string, opts: ScrapeOptions) => Promise<ScrapeRun>;
  onResult?: (venue: { id: string; name: string }, run: ScrapeRun) => void;
  onError?: (venue: { id: string; name: string }, err: unknown) => void;
}

export const DEFAULT_BATCH_CONCURRENCY = 3;

/**
 * Scrape every venue, collapsing all LLM extractions into one batch call.
 * Mirrors the sequential path's logging contract: each venue's outcome is
 * reported as it finishes, and a venue that throws never sinks the others.
 */
export async function scrapeVenuesBatched(
  venues: Array<{ id: string; name: string }>,
  opts: BatchedSweepOptions,
): Promise<void> {
  if (venues.length === 0) return;

  const scrape = opts.scrape ?? scrapeVenue;
  const gate = new Gate(opts.concurrency ?? DEFAULT_BATCH_CONCURRENCY);
  const coordinator = new BatchExtractionCoordinator(venues.length, opts.client, {
    flushTimeoutMs: opts.flushTimeoutMs,
    onFlush: (n) => console.log(`[batch] flushing ${n} venue extraction(s) as one batch`),
  });

  await Promise.all(
    venues.map(async (venue) => {
      await gate.acquire();
      try {
        const run = await scrape(venue.id, { extractor: coordinator.clientFor(venue.id, gate) });
        opts.onResult?.(venue, run);
      } catch (e) {
        // scrapeVenue swallows its own errors and returns status='failed', so
        // this catches only unexpected throws from the finalize path.
        opts.onError?.(venue, e);
      } finally {
        gate.release();
        // Must come last: it can trigger the flush that unblocks everyone else.
        coordinator.taskSettled();
      }
    }),
  );
}

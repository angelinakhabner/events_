import { PROBE_FREE_PER_HOUR, PROBE_PAID_PER_DAY, type ProbeOutcome } from '@afisz/shared';

/**
 * Rate limits and the result cache (GOI-72 §7).
 *
 * Both are in-process on purpose. A limit that resets when the container
 * restarts is weaker than a shared counter, but this endpoint is authenticated
 * and the thing being defended is *our* outbound traffic and model spend, not
 * a login. The alternative — a Redis dependency for two counters — buys
 * accuracy we don't need at this size. Swappable later behind these functions.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** How long a probe result stands in for a re-probe. Long enough that CHECK →
 *  ADD doesn't refetch, short enough that a fixed site is re-read soon. */
export const PROBE_CACHE_TTL_MS = 15 * 60_000;

interface Hits {
  free: number[];
  paid: number[];
}

const hits = new Map<string, Hits>();
const cache = new Map<string, { at: number; outcome: ProbeOutcome }>();

export type QuotaKind = 'free' | 'paid';

/**
 * Record an attempt and say whether it's allowed. Returns false when the user
 * is over their allowance — the caller turns that into `RATE_LIMITED` /
 * `PAID_QUOTA_EXCEEDED` rather than throwing, so the UI gets a sentence.
 */
export function consumeQuota(
  userId: string,
  kind: QuotaKind,
  now: number = Date.now(),
): boolean {
  const entry = hits.get(userId) ?? { free: [], paid: [] };
  const window = kind === 'free' ? HOUR_MS : DAY_MS;
  const limit = kind === 'free' ? PROBE_FREE_PER_HOUR : PROBE_PAID_PER_DAY;

  const kept = entry[kind].filter((t) => now - t < window);
  if (kept.length >= limit) {
    entry[kind] = kept;
    hits.set(userId, entry);
    return false;
  }

  kept.push(now);
  entry[kind] = kept;
  hits.set(userId, entry);
  return true;
}

export function cachedProbe(key: string, now: number = Date.now()): ProbeOutcome | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (now - entry.at > PROBE_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.outcome;
}

export function cacheProbe(key: string, outcome: ProbeOutcome, now: number = Date.now()): void {
  cache.set(key, { at: now, outcome });
}

/** Test seam — the counters and cache are module state by design. */
export function resetProbeLimits(): void {
  hits.clear();
  cache.clear();
}

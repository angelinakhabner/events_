import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VENUES } from './default-venues.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migration = () =>
  readFileSync(
    path.resolve(__dirname, '../../drizzle/0029_merge_stale_seed_venues.sql'),
    'utf-8',
  );

/**
 * GOI-108: the curated list is what `seed()` reconciles the venues table
 * against, and both halves of that reconciliation rest on invariants here.
 */
describe('DEFAULT_VENUES', () => {
  /**
   * The seed repoints a curated venue's row by name and city before upserting
   * it, so that a URL change updates the row instead of inserting a second one
   * beside it. Two curated venues sharing a name in one city would make that
   * lookup ambiguous, and the two would fight over one row on every seed.
   */
  it('names each venue once per city', () => {
    const seen = new Map<string, string>();
    for (const v of DEFAULT_VENUES) {
      const key = `${v.name.trim().toLowerCase()}|${v.city.trim().toLowerCase()}`;
      expect(seen.get(key), `${v.name} in ${v.city} is seeded twice`).toBeUndefined();
      seen.set(key, v.id);
    }
  });

  it('gives each venue its own URL and its own id', () => {
    expect(new Set(DEFAULT_VENUES.map((v) => v.url)).size).toBe(DEFAULT_VENUES.length);
    expect(new Set(DEFAULT_VENUES.map((v) => v.id)).size).toBe(DEFAULT_VENUES.length);
  });

  /**
   * The other half: 0029 merges the rows a past URL change already duplicated.
   * It names the surviving URL literally, so a curated URL edited afterwards
   * without touching the migration would leave it merging into a row that no
   * longer exists — silently doing nothing.
   */
  it('still carries every URL the merge migration merges into', () => {
    const sql = migration();
    const current = new Set(DEFAULT_VENUES.map((v) => v.url));
    // The second column of each VALUES pair — the row that survives.
    const targets = [...sql.matchAll(/^\s+'(https:\/\/[^']+)'\)[,;]?$/gm)].map((m) => m[1]!);

    expect(targets.length).toBeGreaterThan(0);
    for (const url of new Set(targets)) {
      expect(current.has(url), `0029 merges into ${url}, which is no longer seeded`).toBe(true);
    }
  });
});

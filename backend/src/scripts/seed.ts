import { sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { DEFAULT_VENUES } from '../data/default-venues.js';

/**
 * Seed the curated venues.
 *
 * The upsert keys on `url`, which makes a venue's URL its identity — and a
 * curated venue's URL changes. Writing a deterministic scraper for one usually
 * means reading a different page from the one the model had been given, and
 * six of them have moved that way. Each of those moves inserted a *second* row
 * rather than repointing the first, leaving the old one in the table, still
 * subscribed to by everyone seeded before the change, sitting beside its
 * replacement in the venue list (GOI-108).
 *
 * So a curated venue is looked up by name and city first, and its row is
 * repointed at the new URL before the upsert can insert one. Name and city
 * because that is what a curated venue *is* — the same theatre in the same
 * city, whatever page it currently publishes its programme on. A venue a user
 * added under that exact name in that city is the same venue too, and adopting
 * it is right rather than unfortunate.
 *
 * 0029 merges the pairs that already exist; this is what stops the next URL
 * change making another.
 */
export async function seed(): Promise<void> {
  const db = getDb();
  for (const v of DEFAULT_VENUES) {
    // Guarded on the target not already existing: with both rows present this
    // would collide on the unique URL, and merging the two is a migration's
    // job, not a seed's.
    await db.execute(sql`
      UPDATE venues SET url = ${v.url}
       WHERE name = ${v.name} AND city = ${v.city} AND url <> ${v.url}
         AND NOT EXISTS (SELECT 1 FROM venues k WHERE k.url = ${v.url})
    `);
    await db.execute(sql`
      INSERT INTO venues (name, url, city, country, category, language, timezone)
      VALUES (${v.name}, ${v.url}, ${v.city}, ${v.country}, ${v.category}, ${v.language}, ${v.timezone})
      ON CONFLICT (url) DO UPDATE SET
        name = EXCLUDED.name,
        city = EXCLUDED.city,
        country = EXCLUDED.country,
        category = EXCLUDED.category,
        language = EXCLUDED.language,
        timezone = EXCLUDED.timezone
    `);
  }
  console.log(`seeded ${DEFAULT_VENUES.length} venues`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

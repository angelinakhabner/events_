import { sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { DEFAULT_VENUES } from '../data/default-venues.js';

export async function seed(): Promise<void> {
  const db = getDb();
  for (const v of DEFAULT_VENUES) {
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

import { ilike, or, eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { scrapeVenue } from '../services/scraper/runner.js';

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: scrape:one <venue-slug-or-uuid>');
    process.exit(2);
  }
  const db = getDb();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(arg);
  const rows = await db
    .select()
    .from(schema.venues)
    .where(isUuid ? eq(schema.venues.id, arg) : or(ilike(schema.venues.name, `%${arg}%`), ilike(schema.venues.url, `%${arg}%`)))
    .limit(1);
  const venue = rows[0];
  if (!venue) {
    console.error(`No venue matching "${arg}"`);
    process.exit(1);
  }
  console.log(`scraping ${venue.name} (${venue.id})...`);
  const run = await scrapeVenue(venue.id, { force: true });
  console.log(JSON.stringify(run, null, 2));
  process.exit(run.status === 'failed' ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

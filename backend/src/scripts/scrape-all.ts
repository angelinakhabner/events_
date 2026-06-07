import { getDb, schema } from '../db/index.js';
import { scrapeVenue } from '../services/scraper/runner.js';

async function main(): Promise<void> {
  const db = getDb();
  const venues = await db.select().from(schema.venues);
  if (venues.length === 0) {
    console.log('no venues — run db:seed first');
    process.exit(0);
  }
  console.log(`scraping ${venues.length} venue(s)...`);
  const results = await Promise.allSettled(
    venues.map((v) => scrapeVenue(v.id)),
  );
  let ok = 0;
  let failed = 0;
  results.forEach((r, i) => {
    const name = venues[i]!.name;
    if (r.status === 'fulfilled') {
      console.log(`  ${name}: ${r.value.status} (${r.value.eventsFound ?? '-'} events)`);
      if (r.value.status === 'failed') failed++;
      else ok++;
    } else {
      console.error(`  ${name}: threw`, r.reason);
      failed++;
    }
  });
  if (ok === 0 && failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

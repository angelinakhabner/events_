/**
 * How many upcoming shows each venue has a description for (GOI-136, GOI-139).
 *
 *   DATABASE_URL=… npm --workspace backend run descriptions:coverage [-- --category=theatre]
 *
 * Counts *shows* (one venue + title), not showings: a play on twelve nights is
 * one gap, not twelve. Prints one line per venue, worst-covered first, so the
 * theatres whose blanks the writer cannot fill are at the top — the evidence
 * for whether a theatre-specific source (option 2 on GOI-136) is worth adding.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';

interface Row {
  venue: string;
  category: string;
  shows: number;
  described: number;
  long: number;
}

async function main() {
  const category = process.argv.find((a) => a.startsWith('--category='))?.split('=')[1] ?? null;
  const result = await getDb().execute(sql`
    with shows as (
      select v.name as venue, v.category, lower(trim(e.title)) as title,
             bool_or(coalesce(trim(e.description), '') <> '') as described,
             bool_or(coalesce(trim(e.description_long), '') <> '') as long
      from events e join venues v on v.id = e.venue_id
      where e.cancelled_at is null
        and (e.starts_at >= now() or (e.kind = 'exhibition' and e.ends_at >= now()))
        ${category ? sql`and v.category = ${category}` : sql``}
      group by v.name, v.category, lower(trim(e.title))
    )
    select venue, category, count(*)::int as shows,
           count(*) filter (where described)::int as described,
           count(*) filter (where long)::int as long
    from shows group by venue, category
    order by (count(*) filter (where described))::float / count(*), venue
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: Row[] }).rows) as Row[];

  const pct = (n: number, of: number) => `${Math.round((100 * n) / Math.max(of, 1))}%`.padStart(4);
  console.log(`${'venue'.padEnd(36)} ${'category'.padEnd(11)} shows  described     long`);
  for (const r of rows) {
    console.log(
      `${r.venue.slice(0, 35).padEnd(36)} ${r.category.padEnd(11)} ${String(r.shows).padStart(5)}  ` +
      `${String(r.described).padStart(4)} ${pct(r.described, r.shows)}  ${String(r.long).padStart(4)} ${pct(r.long, r.shows)}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

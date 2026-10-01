import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type { WrittenDetail, WrittenStore } from './scraper/enricher.js';

/**
 * How long "found nothing" is believed (GOI-131).
 *
 * A show nobody has written about yet is often one that has not opened yet:
 * the venue's page fills in and the press arrives a week or two before the
 * premiere. Remembering the empty answer for ever would miss that; forgetting
 * it every sweep would pay for the same fruitless search daily. A fortnight
 * sits between the two.
 */
export const EMPTY_ANSWER_TTL_DAYS = 14;

/** The language the writer writes in, and the only one read back. */
export const DESCRIPTION_LANG = 'pl';

/**
 * The English descriptions the enrichment pass has already written, one per
 * show per venue (GOI-130 / GOI-131). The enricher reads it before spending a
 * model call and writes to it after, so each show is paid for once.
 */
export function descriptionStore(venueId: string): WrittenStore {
  return {
    async lookup(keys) {
      const out = new Map<string, WrittenDetail>();
      if (keys.length === 0) return out;
      const rows = await getDb()
        .select({
          showKey: schema.eventDescriptions.showKey,
          description: schema.eventDescriptions.description,
          contentCategory: schema.eventDescriptions.contentCategory,
        })
        .from(schema.eventDescriptions)
        .where(
          and(
            eq(schema.eventDescriptions.venueId, venueId),
            inArray(schema.eventDescriptions.showKey, keys),
            // An answer in another language is a show still to be written.
            eq(schema.eventDescriptions.lang, DESCRIPTION_LANG),
            // An empty answer expires; a written one does not.
            sql`(${schema.eventDescriptions.description} is not null
              or ${schema.eventDescriptions.writtenAt} > now() - make_interval(days => ${EMPTY_ANSWER_TTL_DAYS}))`,
          ),
        );
      for (const r of rows) {
        out.set(r.showKey, { description: r.description, contentCategory: r.contentCategory });
      }
      return out;
    },

    async save(entries) {
      if (entries.length === 0) return;
      const now = new Date();
      await getDb()
        .insert(schema.eventDescriptions)
        .values(entries.map((e) => ({
          venueId,
          showKey: e.key,
          description: e.description,
          contentCategory: e.contentCategory,
          searched: e.searched ?? false,
          lang: DESCRIPTION_LANG,
          writtenAt: now,
        })))
        .onConflictDoUpdate({
          target: [schema.eventDescriptions.venueId, schema.eventDescriptions.showKey],
          set: {
            description: sql`excluded.description`,
            contentCategory: sql`excluded.content_category`,
            searched: sql`excluded.searched`,
            lang: sql`excluded.lang`,
            writtenAt: sql`excluded.written_at`,
          },
        });
    },
  };
}

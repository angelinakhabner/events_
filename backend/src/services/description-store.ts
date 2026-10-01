import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { WRITER_VERSION, type WrittenDetail, type WrittenStore } from './scraper/enricher.js';

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
          longDescription: schema.eventDescriptions.longDescription,
          contentCategory: schema.eventDescriptions.contentCategory,
          writerVersion: schema.eventDescriptions.writerVersion,
        })
        .from(schema.eventDescriptions)
        .where(
          and(
            eq(schema.eventDescriptions.venueId, venueId),
            inArray(schema.eventDescriptions.showKey, keys),
            // An empty answer expires; a written one does not.
            sql`(${schema.eventDescriptions.description} is not null
              or ${schema.eventDescriptions.writtenAt} > now() - make_interval(days => ${EMPTY_ANSWER_TTL_DAYS}))`,
          ),
        );
      for (const r of rows) {
        out.set(r.showKey, {
          description: r.description,
          longDescription: r.longDescription,
          contentCategory: r.contentCategory,
          stale: r.writerVersion < WRITER_VERSION,
        });
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
          longDescription: e.longDescription ?? null,
          contentCategory: e.contentCategory,
          searched: e.searched ?? false,
          writerVersion: WRITER_VERSION,
          writtenAt: now,
        })))
        .onConflictDoUpdate({
          target: [schema.eventDescriptions.venueId, schema.eventDescriptions.showKey],
          set: {
            description: sql`excluded.description`,
            longDescription: sql`excluded.long_description`,
            writerVersion: sql`excluded.writer_version`,
            contentCategory: sql`excluded.content_category`,
            searched: sql`excluded.searched`,
            writtenAt: sql`excluded.written_at`,
          },
        });
    },
  };
}

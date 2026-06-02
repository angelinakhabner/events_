import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, deviceProcedure } from './trpc.js';
import { generateDefaultEvents } from '../data/default-events.js';
import { filterEvents } from '../services/filters.js';

const categorySchema = z.enum(['cinema', 'theatre', 'exhibition', 'comedy', 'music', 'other']);

const eventFiltersSchema = z.object({
  categories: z.array(categorySchema).optional(),
  cities: z.array(z.string()).optional(),
  countries: z.array(z.string()).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  endHour: z.number().int().min(0).max(23).optional(),
  priceMax: z.number().nonnegative().optional(),
});

const venueListInput = z
  .object({
    city: z.string().optional(),
    country: z.string().optional(),
    category: categorySchema.optional(),
  })
  .optional();

const venues = router({
  list: publicProcedure.input(venueListInput).query(({ ctx, input }) => {
    return ctx.venues.list(input ?? {});
  }),
  add: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        url: z.string().url(),
        city: z.string().min(1),
        country: z.string().min(1),
        category: categorySchema,
        language: z.string().default('en'),
      }),
    )
    .mutation(({ ctx, input }) => ctx.venues.add(input)),
  cities: publicProcedure.query(({ ctx }) => ctx.venues.cities()),
  categories: publicProcedure.query(({ ctx }) => ctx.venues.categories()),
});

const events = router({
  listDefault: publicProcedure
    .input(z.object({ filters: eventFiltersSchema.optional() }).optional())
    .query(({ ctx, input }) => {
      const all = generateDefaultEvents();
      const filters = input?.filters ?? {};
      const venueMap = new Map(ctx.venues.list().map((v) => [v.id, v]));
      return filterEvents(all, venueMap, filters);
    }),
});

const folders = router({
  listMine: deviceProcedure.query(({ ctx }) => ctx.folders.list(ctx.deviceId)),

  create: deviceProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        venueIds: z.array(z.string()).default([]),
        filters: eventFiltersSchema.default({}),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.folders.create({ deviceId: ctx.deviceId, ...input }),
    ),

  update: deviceProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(80).optional(),
        venueIds: z.array(z.string()).optional(),
        filters: eventFiltersSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.folders.update({ deviceId: ctx.deviceId, ...input });
      } catch (e) {
        throw mapStoreError(e);
      }
    }),

  delete: deviceProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const ok = await ctx.folders.delete(ctx.deviceId, input.id);
        return { success: ok };
      } catch (e) {
        throw mapStoreError(e);
      }
    }),

  getEvents: deviceProcedure
    .input(z.object({ folderId: z.string() }))
    .query(async ({ ctx, input }) => {
      const folder = await ctx.folders.get(ctx.deviceId, input.folderId);
      if (!folder) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Folder ${input.folderId} not found` });
      }
      const all = generateDefaultEvents();
      const venueMap = new Map(ctx.venues.list().map((v) => [v.id, v]));
      const scoped = folder.venueIds.length
        ? all.filter((e) => folder.venueIds.includes(e.venueId))
        : all;
      return filterEvents(scoped, venueMap, folder.filters);
    }),
});

function mapStoreError(e: unknown): TRPCError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/forbidden/i.test(msg)) return new TRPCError({ code: 'UNAUTHORIZED', message: msg });
  if (/not found/i.test(msg)) return new TRPCError({ code: 'NOT_FOUND', message: msg });
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: msg });
}

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
  venues,
  events,
  folders,
});

export type AppRouter = typeof appRouter;

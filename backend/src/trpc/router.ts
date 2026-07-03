import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, userProcedure, ownerProcedure } from './trpc.js';
import { requestMagicLink, verifyMagicLink, logout as authLogout } from '../services/auth.js';
import { generateDefaultEvents } from '../data/default-events.js';
import { filterEvents } from '../services/filters.js';
import { defaultEventStore } from '../services/event-store.js';
import { scrapeVenue } from '../services/scraper/runner.js';
import { env } from '../config.js';

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
        timezone: z.string().default('Europe/Warsaw'),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (!ctx.venues.add) {
        throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'add is not supported by this store' });
      }
      return ctx.venues.add(input);
    }),
  cities: publicProcedure.query(({ ctx }) => ctx.venues.cities()),
  categories: publicProcedure.query(({ ctx }) => ctx.venues.categories()),
});

const events = router({
  listDefault: publicProcedure
    .input(z.object({ filters: eventFiltersSchema.optional() }).optional())
    .query(async ({ input }) => {
      // Reads only from DB. NEVER triggers scraping — that happens via cron
      // (scrape:all) or the admin.triggerScrape procedure.
      if (!env.DATABASE_URL) return [];
      const rows = await defaultEventStore.listUpcoming({ city: 'Warsaw', limit: 100 });
      const filters = input?.filters ?? {};
      // Re-use the existing filter logic. Venues map left empty so per-venue
      // filters (city/country) don't strip rows we already scoped by city.
      return filterEvents(rows, new Map(), filters);
    }),

  listByVenue: publicProcedure
    .input(z.object({ venueId: z.string() }))
    .query(async ({ input }) => {
      if (!env.DATABASE_URL) return [];
      return defaultEventStore.listUpcoming({ venueId: input.venueId, limit: 200 });
    }),
});

const admin = router({
  triggerScrape: publicProcedure
    .input(z.object({ venueId: z.string(), force: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      if (!env.DATABASE_URL) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DATABASE_URL not configured' });
      }
      return scrapeVenue(input.venueId, { force: input.force });
    }),
});

const auth = router({
  requestLink: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const res = await requestMagicLink(ctx.auth, input.email);
      // Never leak the token over the API — it only travels by email (or the
      // server log in dev). The response is intentionally the same whether or
      // not the address exists.
      return { ok: true, emailSent: res.emailSent };
    }),

  verify: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const res = await verifyMagicLink(ctx.auth, input.token);
      if (!res) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Login link is invalid or expired' });
      }
      // First login: populate /my with the default venues so the page never
      // starts empty. No-op for returning users.
      await ctx.userVenues.ensureSeeded(res.user.id);
      return res;
    }),

  me: publicProcedure.query(({ ctx }) => ctx.user),

  logout: userProcedure.mutation(async ({ ctx }) => {
    if (ctx.sessionToken) await authLogout(ctx.auth, ctx.sessionToken);
    return { ok: true };
  }),
});

const myVenueUpdateInput = z.object({
  venueId: z.string(),
  /** New display name; null resets to the shared venue's name. */
  name: z.string().min(1).max(120).nullable().optional(),
  /** New category; null resets to the shared venue's category. */
  category: categorySchema.nullable().optional(),
  /** Personal scrape horizon in days; null = category default. */
  windowDays: z.number().int().min(1).max(90).nullable().optional(),
});

const my = router({
  venues: router({
    list: userProcedure.query(async ({ ctx }) => {
      await ctx.userVenues.ensureSeeded(ctx.user.id);
      return ctx.userVenues.list(ctx.user.id);
    }),

    add: userProcedure
      .input(
        z.object({
          name: z.string().min(1).max(120),
          url: z.string().url(),
          city: z.string().min(1).default('Warsaw'),
          country: z.string().min(1).default('PL'),
          category: categorySchema,
          windowDays: z.number().int().min(1).max(90).nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.userVenues.addCustom(ctx.user.id, input)),

    update: userProcedure.input(myVenueUpdateInput).mutation(async ({ ctx, input }) => {
      const { venueId, ...patch } = input;
      try {
        return await ctx.userVenues.update(ctx.user.id, venueId, patch);
      } catch (e) {
        throw mapStoreError(e);
      }
    }),

    remove: userProcedure
      .input(z.object({ venueId: z.string() }))
      .mutation(async ({ ctx, input }) => ({
        success: await ctx.userVenues.remove(ctx.user.id, input.venueId),
      })),
  }),

  wantToGo: router({
    list: userProcedure.query(({ ctx }) => ctx.wantToGo.list(ctx.user.id)),
    ids: userProcedure.query(({ ctx }) => ctx.wantToGo.listIds(ctx.user.id)),
    add: userProcedure
      .input(z.object({ eventId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.wantToGo.add(ctx.user.id, input.eventId);
        return { ok: true };
      }),
    remove: userProcedure
      .input(z.object({ eventId: z.string() }))
      .mutation(async ({ ctx, input }) => ({
        success: await ctx.wantToGo.remove(ctx.user.id, input.eventId),
      })),
  }),
});

const folders = router({
  listMine: ownerProcedure.query(({ ctx }) => ctx.folders.list(ctx.ownerId)),

  create: ownerProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        venueIds: z.array(z.string()).default([]),
        filters: eventFiltersSchema.default({}),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.folders.create({ deviceId: ctx.ownerId, ...input }),
    ),

  update: ownerProcedure
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
        return await ctx.folders.update({ deviceId: ctx.ownerId, ...input });
      } catch (e) {
        throw mapStoreError(e);
      }
    }),

  delete: ownerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const ok = await ctx.folders.delete(ctx.ownerId, input.id);
        return { success: ok };
      } catch (e) {
        throw mapStoreError(e);
      }
    }),

  getEvents: ownerProcedure
    .input(z.object({ folderId: z.string() }))
    .query(async ({ ctx, input }) => {
      const folder = await ctx.folders.get(ctx.ownerId, input.folderId);
      if (!folder) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Folder ${input.folderId} not found` });
      }
      const all = generateDefaultEvents();
      const venues = await ctx.venues.list();
      const venueMap = new Map(venues.map((v) => [v.id, v]));
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
  admin,
  auth,
  my,
});

export type AppRouter = typeof appRouter;

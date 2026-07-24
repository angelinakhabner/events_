import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, userProcedure, ownerProcedure } from './trpc.js';
import { requestMagicLink, verifyMagicLink, logout as authLogout } from '../services/auth.js';
import { googleAuthEnabled } from '../services/google-auth.js';
import { generateDefaultEvents } from '../data/default-events.js';
import { filterEvents } from '../services/filters.js';
import { defaultEventStore } from '../services/event-store.js';
import { scrapeVenue } from '../services/scraper/runner.js';
import { probeVenueUrl } from '../services/scraper/probe.js';
import { listFestivals } from '../data/festivals.js';
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

  /** Upcoming screenings of one title across every venue, soonest first —
   *  powers the "Nearest screenings" button on film cards. */
  screenings: publicProcedure
    .input(z.object({ title: z.string().min(1) }))
    .query(async ({ input }) => {
      if (!env.DATABASE_URL) return [];
      return defaultEventStore.listUpcoming({ title: input.title, limit: 50 });
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
  /** Which login methods this deployment offers — drives the login UI. */
  methods: publicProcedure.query(() => ({
    magicLink: true,
    google: googleAuthEnabled(),
  })),

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
  lists: router({
    list: userProcedure.query(async ({ ctx }) => {
      await ctx.userVenues.ensureSeeded(ctx.user.id);
      return ctx.userVenues.lists(ctx.user.id);
    }),

    create: userProcedure
      .input(z.object({ name: z.string().trim().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await ctx.userVenues.createList(ctx.user.id, input.name);
        } catch (e) {
          throw mapStoreError(e);
        }
      }),

    rename: userProcedure
      .input(z.object({ listId: z.string(), name: z.string().trim().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await ctx.userVenues.renameList(ctx.user.id, input.listId, input.name);
        } catch (e) {
          throw mapStoreError(e);
        }
      }),

    remove: userProcedure
      .input(z.object({ listId: z.string() }))
      .mutation(async ({ ctx, input }) => ({
        success: await ctx.userVenues.removeList(ctx.user.id, input.listId),
      })),

    setActive: userProcedure
      .input(z.object({ listId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await ctx.userVenues.setActiveList(ctx.user.id, input.listId);
          return { ok: true };
        } catch (e) {
          throw mapStoreError(e);
        }
      }),
  }),

  venues: router({
    list: userProcedure
      .input(z.object({ listId: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        await ctx.userVenues.ensureSeeded(ctx.user.id);
        return ctx.userVenues.list(ctx.user.id, input?.listId);
      }),

    add: userProcedure
      .input(
        z.object({
          name: z.string().min(1).max(120),
          url: z.string().url(),
          city: z.string().min(1).default('Warsaw'),
          country: z.string().min(1).default('PL'),
          category: categorySchema,
          /** BCP-47-ish primary tag of the venue page ("pl", "en"); the AI
           *  extractor uses it as a parsing hint. Defaults to Polish. */
          language: z.string().trim().toLowerCase().regex(/^[a-z]{2,3}$/).optional(),
          windowDays: z.number().int().min(1).max(90).nullable().optional(),
          listId: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await ctx.userVenues.addCustom(ctx.user.id, input);
        } catch (e) {
          throw mapStoreError(e);
        }
      }),

    /** Dry-run scrapability check for the add-venue form: fetches the URL the
     *  way a real scrape would and reports whether/how events could be
     *  extracted. Never calls the LLM, never writes anything. */
    checkUrl: userProcedure
      .input(z.object({ url: z.string().url() }))
      .mutation(({ input }) => probeVenueUrl(input.url)),

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

  films: router({
    list: userProcedure.query(({ ctx }) => ctx.films.list(ctx.user.id)),
    add: userProcedure
      .input(z.object({ title: z.string().trim().min(1).max(200) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await ctx.films.add(ctx.user.id, input.title);
        } catch (e) {
          throw mapStoreError(e);
        }
      }),
    markSeen: userProcedure
      .input(
        z.object({
          filmId: z.string(),
          watchedVenue: z.string().trim().max(120).optional(),
          comment: z.string().trim().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const { filmId, ...details } = input;
          return await ctx.films.markSeen(ctx.user.id, filmId, details);
        } catch (e) {
          throw mapStoreError(e);
        }
      }),
    moveToWant: userProcedure
      .input(z.object({ filmId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await ctx.films.moveToWant(ctx.user.id, input.filmId);
        } catch (e) {
          throw mapStoreError(e);
        }
      }),
    remove: userProcedure
      .input(z.object({ filmId: z.string() }))
      .mutation(async ({ ctx, input }) => ({
        success: await ctx.films.remove(ctx.user.id, input.filmId),
      })),
  }),

  newsletter: router({
    get: userProcedure.query(({ ctx }) => ctx.newsletter.get(ctx.user.id)),
    save: userProcedure
      .input(
        z.object({
          email: z.string().email(),
          frequency: z.enum(['daily', 'weekly']),
          venueIds: z.array(z.string()).default([]),
          afterHour: z.number().int().min(0).max(23).nullable().optional(),
          beforeHour: z.number().int().min(0).max(23).nullable().optional(),
          enabled: z.boolean().default(true),
        }),
      )
      .mutation(({ ctx, input }) => ctx.newsletter.save(ctx.user.id, input)),
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
  if (/already have/i.test(msg)) return new TRPCError({ code: 'CONFLICT', message: msg });
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: msg });
}

const festivals = router({
  /** Ongoing and upcoming film festivals at covered cinemas, soonest first. */
  list: publicProcedure.query(() => listFestivals()),
});

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
  venues,
  events,
  folders,
  festivals,
  admin,
  auth,
  my,
});

export type AppRouter = typeof appRouter;

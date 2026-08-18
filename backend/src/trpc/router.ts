import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, userProcedure, ownerProcedure } from './trpc.js';
import { requestMagicLink, verifyMagicLink, logout as authLogout } from '../services/auth.js';
import { googleAuthEnabled } from '../services/google-auth.js';
import { generateDefaultEvents } from '../data/default-events.js';
import { filterEvents } from '../services/filters.js';
import { defaultEventStore } from '../services/event-store.js';
import { scrapeVenue } from '../services/scraper/runner.js';
import { probeVenueUrl, problem as probeProblem } from '../services/probe/index.js';
import { normalizeVenueUrl } from '../services/probe/normalize.js';
import { defaultProbeExtractor } from '../services/probe/extract.js';
import { defaultPaidFetcher } from '../services/probe/paid.js';
import { cacheProbe, cachedProbe, consumeQuota } from '../services/probe/limits.js';
import { listFestivals } from '../data/festivals.js';
import {
  festivalsAtVenues, venueSchedule,
  venueFilterStatus, venueSlug,
  type ProbeOutcome, type SharedWantToGoList, type SourceConfidence, type SourceMethod,
  type VenueFilterOption,
} from '@afisz/shared';
import {
  briefWindowDays, buildBriefSections, currentFestival, plannedFrequency, resolveBriefVenues,
} from '../services/newsletter.js';
import { dedupe as dedupeSuggestions, suggestSimilarVenues } from '../services/venue-suggest.js';
import { renderBriefHtml } from '../services/newsletter-render.js';
import { newsletterSaveInput } from '../services/newsletter-input.js';
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
      const filters = input?.filters ?? {};
      // Narrow by category in SQL, before the limit (GOI-70). Fetching the 100
      // globally-earliest Warsaw events and *then* keeping the music ones is
      // how the home page came to show less music than /my did for the same
      // venues: a cinema publishes eight screenings a day, so those 100 rows
      // were spent long before the week's concerts appeared in them. /my never
      // had the bug because it narrows by venue in SQL.
      //
      // That fixes the *filtered* view. Unfiltered, there is nothing to narrow
      // to — every category is wanted at once — so the limit still buries the
      // sparse ones, and a category with nothing on in the next few days drops
      // out of the feed even with a full autumn programme behind it. Which is
      // every Warsaw theatre in July and August. So each category short of the
      // floor is topped up from within a 90-day window (GOI-85).
      const rows = await defaultEventStore.listUpcomingWithCategoryFloor({
        city: 'Warsaw',
        categories: filters.categories,
        limit: 100,
      });
      // Re-use the existing filter logic for the dimensions SQL didn't cover
      // (day, hour, price). Venues map left empty so per-venue filters
      // (city/country) don't strip rows we already scoped by city.
      return filterEvents(rows, new Map(), filters);
    }),

  listByVenue: publicProcedure
    .input(z.object({ venueId: z.string() }))
    .query(async ({ input }) => {
      if (!env.DATABASE_URL) return [];
      return defaultEventStore.listUpcoming({ venueId: input.venueId, limit: 200 });
    }),

  /**
   * The venue filter row's chips (GOI-76 §6): every venue in the category,
   * with how many events it has under the current day/time filters.
   *
   * Note what the input does *not* take: the venue selection. Counts must be
   * computed with the selection excluded, or every unselected venue reads 0
   * the moment one is picked and the row destroys its own usefulness. Leaving
   * it out of the signature is the cheapest way to make that mistake
   * impossible rather than merely discouraged — and it means React Query
   * caches the counts across selection changes for free, since the key can't
   * contain the selection.
   */
  filterOptions: publicProcedure
    .input(
      z.object({
        category: categorySchema.optional(),
        /** Warsaw calendar day, YYYY-MM-DD. */
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        fromHour: z.number().int().min(0).max(23).optional(),
      }).optional(),
    )
    .query(async ({ input }): Promise<{ venues: VenueFilterOption[] }> => {
      if (!env.DATABASE_URL) return { venues: [] };
      const now = new Date();
      const rows = await defaultEventStore.venueFilterCounts({
        category: input?.category,
        city: 'Warsaw',
        day: input?.day,
        fromHour: input?.fromHour,
        now,
      });

      const venues = rows.map((r) => ({
        id: r.id,
        slug: venueSlug(r.name),
        name: r.name,
        category: r.category,
        count: r.count,
        status: venueFilterStatus(r, now),
        lastScrapedAt: r.lastScrapedAt,
      }));

      // Sorted here so every caller gets the same order for the same inputs.
      // The frontend still freezes it per category session — see GOI-76 §3.
      venues.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return { venues };
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
  /** Whole replacement tag set (GOI-25). */
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  /** Move the venue into another folder (GOI-25). */
  listId: z.string().optional(),
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

    /** Every venue the user follows, across all folders — the "My venues"
     *  tab groups these by folder itself (GOI-25). */
    listAll: userProcedure.query(async ({ ctx }) => {
      await ctx.userVenues.ensureSeeded(ctx.user.id);
      return ctx.userVenues.listAll(ctx.user.id);
    }),

    /**
     * Whether each followed venue is running, quiet or dark (GOI-13). Kept
     * separate from `listAll` so the venue list still renders instantly if
     * this aggregate is slow, and so it can be refetched on its own.
     */
    activity: userProcedure.query(async ({ ctx }) => {
      if (!env.DATABASE_URL) return [];
      await ctx.userVenues.ensureSeeded(ctx.user.id);
      const venues = await ctx.userVenues.listAll(ctx.user.id);
      const now = new Date();
      const activity = await defaultEventStore.venueActivity(venues.map((v) => v.id), now);
      return activity.map((a) => ({ venueId: a.venueId, ...venueSchedule(a, now) }));
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
          /** Personal tags typed in the add form (GOI-74). Same shape and
           *  limits as the update path, so a tag can't arrive by one route
           *  that the other would reject. */
          tags: z.array(z.string().trim().max(40)).max(20).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await ctx.userVenues.addCustom(ctx.user.id, input);
        } catch (e) {
          throw mapStoreError(e);
        }
      }),

    /**
     * "Whether and how can this venue be scraped" (GOI-72).
     *
     * Note the input is `z.string()`, not `z.string().url()`. That validator is
     * the reported bug: it rejects the bare host people actually paste
     * ("www.teatr-zydowski.art.pl") and its complaint reached the UI verbatim.
     * Normalization happens inside the probe and every failure comes back as a
     * coded, translated sentence instead.
     *
     * Authenticated because it fetches an arbitrary URL on request, rate
     * limited because it fetches several, and cached because pressing ADD
     * straight after CHECK must not probe the site twice.
     */
    checkUrl: userProcedure
      .input(
        z.object({
          url: z.string().min(1).max(2048),
          locale: z.enum(['pl', 'en']).default('pl'),
          /** Consent to spend a paid render; honoured only after the free
           *  ladder has already returned JS_RENDERED_NEEDS_PAID. */
          allowPaid: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }): Promise<ProbeOutcome> => {
        const { locale } = input;

        // Normalize before anything else so the cache key, the quota and the
        // shared-venue lookup all agree on what "the same URL" means.
        const normalized = normalizeVenueUrl(input.url);
        if (!normalized.ok) return probeProblem(normalized.code, locale, null);
        const key = normalized.url.toString();

        // Already a venue? Hand back what we know without touching the network
        // — this is the "you'll share it" promise the form already makes.
        const existing = await ctx.venues.findByNormalizedUrl?.(key);
        if (existing?.sourceMethod) {
          return {
            status: 'success',
            normalizedUrl: key,
            sourceUrl: existing.sourceUrl ?? key,
            method: existing.sourceMethod as SourceMethod,
            confidence: (existing.sourceConfidence ?? 'medium') as SourceConfidence,
            suggestedName: existing.name,
            language: existing.language,
            sampleEvents: [],
            shared: true,
          };
        }

        if (!input.allowPaid) {
          const cached = cachedProbe(key);
          if (cached) return cached;
        }

        if (!consumeQuota(ctx.user.id, input.allowPaid ? 'paid' : 'free')) {
          return probeProblem(
            input.allowPaid ? 'PAID_QUOTA_EXCEEDED' : 'RATE_LIMITED',
            locale,
            key,
          );
        }

        const outcome = await probeVenueUrl(input.url, {
          locale,
          allowPaid: input.allowPaid,
          paidFetcher: defaultPaidFetcher(),
          extract: defaultProbeExtractor(),
        });
        cacheProbe(key, outcome);
        return outcome;
      }),

    /**
     * Scrape one of your venues right now (GOI-75). The nightly sweep is the
     * only thing that normally fills a venue, so a venue you just added shows
     * nothing until it runs and there is no way to tell "the scraper hasn't
     * got to it yet" from "the scraper can't read this page". This runs the
     * real pipeline and hands back the run, so the answer is on screen.
     *
     * Deliberately not `admin.triggerScrape`: that one takes any venue id from
     * anyone. This is scoped to venues the caller actually follows, and never
     * forces — an unchanged page reports `skipped_unchanged` instead of paying
     * for another extraction on every click.
     */
    refresh: userProcedure
      .input(z.object({ venueId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (!env.DATABASE_URL) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DATABASE_URL not configured' });
        }
        const venues = await ctx.userVenues.listAll(ctx.user.id);
        if (!venues.some((v) => v.id === input.venueId)) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'That venue is not in your list.' });
        }
        return scrapeVenue(input.venueId);
      }),

    /**
     * "Propose me similar venues in city X, like the ones in folder Y, of
     * type Z" (GOI-86).
     *
     * A mutation rather than a query because it costs a model call: queries
     * are refetched on focus, on reconnect and on cache invalidation, and none
     * of those are moments the user asked to spend money.
     *
     * Suggestions are returned, never subscribed. Adding one goes through the
     * ordinary `add` path, so it is probed like any pasted URL and a
     * hallucinated address fails there rather than becoming a silent venue
     * that never yields events.
     */
    suggestSimilar: userProcedure
      .input(
        z.object({
          /** Folder whose venues are the taste exemplars. */
          listId: z.string().min(1),
          /** Target city, as typed. */
          city: z.string().trim().min(1).max(80),
          /** Optional narrowing ("Museums"). Free text — the ticket's example
           *  is a phrase, not an enum. */
          type: z.string().trim().max(60).optional(),
          limit: z.number().int().min(1).max(10).default(6),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const like = await ctx.userVenues.list(ctx.user.id, input.listId);
        if (like.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'That folder has no venues yet — add a couple first, so there is something to match against.',
          });
        }
        // Everything the user follows, not just this folder: a venue already
        // in another folder is not a useful suggestion either.
        const followed = await ctx.userVenues.listAll(ctx.user.id);

        let suggestions;
        try {
          suggestions = await suggestSimilarVenues({
            like: like.map((v) => ({ name: v.name, city: v.city, category: v.category, tags: v.tags })),
            city: input.city,
            type: input.type,
            limit: input.limit,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          throw new TRPCError({
            code: message.includes('ANTHROPIC_API_KEY') ? 'PRECONDITION_FAILED' : 'INTERNAL_SERVER_ERROR',
            message: message.includes('ANTHROPIC_API_KEY')
              ? 'Venue suggestions need ANTHROPIC_API_KEY to be configured on the server.'
              : `Could not get suggestions: ${message}`,
          });
        }

        return {
          city: input.city,
          type: input.type ?? null,
          basedOn: like.length,
          suggestions: dedupeSuggestions(
            suggestions,
            followed.map((v) => ({ name: v.name, city: v.city, category: v.category })),
            followed.map((v) => v.url),
          ),
        };
      }),

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
      .input(newsletterSaveInput)
      .mutation(({ ctx, input }) => ctx.newsletter.save(ctx.user.id, input)),

    /** "Generate" (GOI-28): render the brief the current settings would
     *  produce, without saving or sending anything. */
    preview: userProcedure
      .input(newsletterSaveInput)
      .mutation(async ({ ctx, input }) => {
        const venues = await resolveBriefVenues(ctx.user.id, input.venueIds, ctx.userVenues);
        // Narrowed in SQL for the same reason the sender is: `limit` cuts the
        // globally earliest rows, so a preview built from "the next 500 events"
        // showed a short week once the database outgrew that.
        const now = new Date();
        const all = env.DATABASE_URL && venues.length > 0
          ? await defaultEventStore.listUpcoming({
            venueIds: venues.map((v) => v.id),
            now,
            until: new Date(now.getTime() + briefWindowDays(plannedFrequency(input)) * 24 * 3_600_000),
            limit: 500,
          })
          : [];
        // The preview shows what would go out *now*, so a section whose
        // cadence isn't due today is genuinely absent from it — same rule the
        // sweep applies.
        const sections = buildBriefSections(all, input, venues, now);
        return {
          events: sections.flatMap((s) => s.events),
          html: renderBriefHtml({
            sections,
            fallbackFrequency: plannedFrequency(input),
            recipientName: input.recipientName,
            festival: currentFestival(),
            now,
          }),
        };
      }),
  }),

  wantToGo: router({
    list: userProcedure.query(({ ctx }) => ctx.wantToGo.list(ctx.user.id)),
    /** Saved events with their seen state — the /my "Want to go" list. */
    entries: userProcedure.query(({ ctx }) => ctx.wantToGo.listEntries(ctx.user.id)),
    ids: userProcedure.query(({ ctx }) => ctx.wantToGo.listIds(ctx.user.id)),
    add: userProcedure
      .input(z.object({ eventId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.wantToGo.add(ctx.user.id, input.eventId);
        return { ok: true };
      }),
    setSeen: userProcedure
      .input(z.object({ eventId: z.string(), seen: z.boolean() }))
      .mutation(async ({ ctx, input }) => ({
        success: await ctx.wantToGo.setSeen(ctx.user.id, input.eventId, input.seen),
      })),
    remove: userProcedure
      .input(z.object({ eventId: z.string() }))
      .mutation(async ({ ctx, input }) => ({
        success: await ctx.wantToGo.remove(ctx.user.id, input.eventId),
      })),

    /** GOI-47: a read-only public link to this list. */
    share: router({
      get: userProcedure.query(async ({ ctx }) => ({
        token: await ctx.wantToGo.shareToken(ctx.user.id),
      })),
      enable: userProcedure.mutation(async ({ ctx }) => ({
        token: await ctx.wantToGo.share(ctx.user.id),
      })),
      disable: userProcedure.mutation(async ({ ctx }) => ({
        success: await ctx.wantToGo.unshare(ctx.user.id),
      })),
    }),
  }),

  /** GOI-27: what's on at the venues the user follows. */
  events: router({
    list: userProcedure
      .input(z.object({ listId: z.string().optional(), filters: eventFiltersSchema.optional() }).optional())
      .query(async ({ ctx, input }) => {
        if (!env.DATABASE_URL) return [];
        await ctx.userVenues.ensureSeeded(ctx.user.id);
        const venues = await ctx.userVenues.list(ctx.user.id, input?.listId);
        if (venues.length === 0) return [];
        // Ask for this user's venues in SQL rather than filtering the globally
        // earliest 500 rows — otherwise following a quiet venue shows nothing
        // as soon as busier ones fill the limit. The selected category is
        // narrowed in SQL for exactly the same reason (GOI-71): a theatre back
        // from summer break sits behind two months of cinema, so filtering
        // after the limit reported "nothing at your venues" for a venue My
        // Venues was simultaneously showing 20 upcoming events for.
        const scoped = await defaultEventStore.listUpcoming({
          venueIds: venues.map((v) => v.id),
          categories: input?.filters?.categories,
          limit: 500,
        });
        // The user's own name/category overrides are what they expect to
        // filter and read, so apply them over the shared venue summary.
        const venueMap = new Map(venues.map((v) => [v.id, v]));
        const shown = scoped.map((e) => {
          const mineVenue = venueMap.get(e.venueId);
          return mineVenue
            ? { ...e, venue: { ...(e.venue ?? mineVenue), name: mineVenue.name, category: mineVenue.category } }
            : e;
        });
        return filterEvents(shown, new Map(), input?.filters ?? {});
      }),
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

  /**
   * The same list narrowed to festivals hosted at venues the user actually
   * follows (GOI-33), each annotated with which of *their* venues host it.
   *
   * Matching uses the user's own venue names — including personal renames —
   * so the answer is phrased in the names they see on their own list.
   */
  mine: userProcedure.query(async ({ ctx }) => {
    await ctx.userVenues.ensureSeeded(ctx.user.id);
    const venues = await ctx.userVenues.listAll(ctx.user.id);
    return festivalsAtVenues(listFestivals(), venues.map((v) => v.name));
  }),
});

/**
 * Reading someone else's "want to go" list through a share link (GOI-47).
 *
 * Public on purpose: the point is that you can send the link to someone
 * without an account. The token is the whole credential, so a revoked or
 * made-up one is a flat NOT_FOUND — the response never distinguishes "no such
 * link" from "that user shares nothing", and never names the owner.
 */
const sharedList = router({
  get: publicProcedure
    .input(z.object({ token: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }): Promise<SharedWantToGoList> => {
      const ownerId = await ctx.wantToGo.ownerOfShareToken(input.token);
      if (!ownerId) throw new TRPCError({ code: 'NOT_FOUND', message: 'This list is not shared.' });
      const [entries, films] = await Promise.all([
        ctx.wantToGo.listEntries(ownerId),
        ctx.films.list(ownerId),
      ]);
      // A shared list is an invitation, not a diary: only what the owner
      // still wants to go to.
      return {
        entries: entries.filter((e) => e.seenAt === null),
        films: films.filter((f) => f.status !== 'seen'),
      };
    }),
});

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
  venues,
  events,
  folders,
  festivals,
  sharedList,
  admin,
  auth,
  my,
});

export type AppRouter = typeof appRouter;

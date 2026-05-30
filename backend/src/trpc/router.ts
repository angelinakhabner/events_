import { z } from 'zod';
import { router, publicProcedure } from './trpc.js';

const categorySchema = z.enum(['cinema', 'theatre', 'exhibition', 'comedy', 'music', 'other']);

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),

  getVenues: publicProcedure
    .input(
      z
        .object({
          city: z.string().optional(),
          country: z.string().optional(),
          category: categorySchema.optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      return ctx.venues.list(input ?? {});
    }),

  addVenue: publicProcedure
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
    .mutation(({ ctx, input }) => {
      return ctx.venues.add(input);
    }),

  listCities: publicProcedure.query(({ ctx }) => ctx.venues.cities()),
  listCategories: publicProcedure.query(({ ctx }) => ctx.venues.categories()),
});

export type AppRouter = typeof appRouter;

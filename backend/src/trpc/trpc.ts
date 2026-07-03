import { initTRPC, TRPCError } from '@trpc/server';
import type { AppContext } from './context.js';

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const deviceProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.deviceId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing x-device-id header' });
  }
  return next({ ctx: { ...ctx, deviceId: ctx.deviceId } });
});

/** Requires a valid session (Authorization: Bearer <token>). */
export const userProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Login required' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Owner key for folder storage: logged-in users share folders across devices;
 *  anonymous users stay keyed by device. Stored in folders.device_id, so a
 *  login upgrade needs no schema change. */
export const ownerProcedure = t.procedure.use(({ ctx, next }) => {
  const owner = ctx.user ? `user:${ctx.user.id}` : ctx.deviceId;
  if (!owner) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Login or x-device-id required' });
  }
  return next({ ctx: { ...ctx, ownerId: owner } });
});

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

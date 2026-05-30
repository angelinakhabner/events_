import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';

export function createApp() {
  const app = new Hono();

  app.use('*', cors({ origin: '*' }));

  app.get('/health', (c) => c.json({ ok: true }));

  app.use(
    '/trpc/*',
    trpcServer({
      router: appRouter,
      createContext: createContext as never,
      endpoint: '/trpc',
    }),
  );

  return app;
}

export type App = ReturnType<typeof createApp>;

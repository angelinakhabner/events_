import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { env } from './config.js';

const app = createApp();

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`Goin backend listening on http://${info.address}:${info.port}`);
});

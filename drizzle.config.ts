import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './backend/src/db/schema.ts',
  out: './backend/drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});

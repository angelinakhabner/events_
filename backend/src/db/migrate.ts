import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { env } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../drizzle');

export async function runMigrations(databaseUrl = env.DATABASE_URL): Promise<void> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations');
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const files = (await fs.readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const content = await fs.readFile(path.join(migrationsDir, file), 'utf-8');
      await sql.unsafe(content);
      console.log(`applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}

export async function dropAll(databaseUrl = env.DATABASE_URL): Promise<void> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required to drop tables');
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.unsafe(
      `DROP TABLE IF EXISTS "folders" CASCADE; DROP TABLE IF EXISTS "venues" CASCADE;`,
    );
    console.log('dropped tables');
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  const main = async () => {
    if (cmd === 'reset') {
      await dropAll();
      await runMigrations();
    } else {
      await runMigrations();
    }
  };
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

/**
 * Invite administration for the access gate (GOI-83). No admin UI by design —
 * this is a temporary curtain, and a UI would be one more thing to delete.
 *
 *   npm --workspace backend run invites -- create <label> [--days N]
 *   npm --workspace backend run invites -- list
 *   npm --workspace backend run invites -- revoke <label|hash-prefix>
 *
 * `create` prints the URL exactly once. It is unrecoverable afterwards —
 * only the SHA-256 is stored — so losing it means minting a new one.
 */
import { eq, like } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { env } from '../config.js';
import { hashToken, mintToken, type InviteRow } from '../services/invite-gate.js';

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — invites live in the database.');
    process.exit(1);
  }

  switch (command) {
    case 'create':
      await create(rest);
      break;
    case 'list':
      await list();
      break;
    case 'revoke':
      await revoke(rest);
      break;
    default:
      console.error('usage: invites create <label> [--days N] | list | revoke <label|hash-prefix>');
      process.exit(1);
  }
}

async function create(args: string[]) {
  const label = args.find((a) => !a.startsWith('--'));
  if (!label) {
    console.error('usage: invites create <label> [--days N]');
    process.exit(1);
  }

  const daysArg = args[args.indexOf('--days') + 1];
  const days = args.includes('--days') ? Number(daysArg) : null;
  if (days !== null && (!Number.isFinite(days) || days <= 0)) {
    console.error('--days must be a positive number');
    process.exit(1);
  }
  const expiresAt = days === null ? null : new Date(Date.now() + days * 86_400_000);

  const token = mintToken();
  await getDb().insert(schema.invites).values({
    tokenHash: hashToken(token),
    label,
    expiresAt,
  });

  // The base is the API origin: /i/<token> is served by this backend, which is
  // what sets the cookie. It redirects to APP_URL afterwards.
  const base = (env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, '');
  console.log('');
  console.log(`  Invite for "${label}"${expiresAt ? ` — expires ${expiresAt.toISOString()}` : ''}`);
  console.log('');
  console.log(`  ${base}/i/${token}`);
  console.log('');
  console.log('  This link is shown once and cannot be recovered — only its hash is stored.');
  console.log('');
}

async function list() {
  const rows = (await getDb().select().from(schema.invites)) as InviteRow[];
  if (rows.length === 0) {
    console.log('No invites.');
    return;
  }

  const now = Date.now();
  const status = (r: InviteRow) => {
    if (r.revokedAt) return 'revoked';
    if (r.expiresAt && r.expiresAt.getTime() <= now) return 'expired';
    return 'active';
  };

  console.table(
    rows
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((r) => ({
        label: r.label,
        status: status(r),
        uses: r.useCount,
        lastUsed: r.lastUsedAt ? r.lastUsedAt.toISOString().slice(0, 16).replace('T', ' ') : '—',
        expires: r.expiresAt ? r.expiresAt.toISOString().slice(0, 10) : 'never',
        // Enough to identify a row for `revoke`, not enough to be a token.
        id: r.tokenHash.slice(0, 8),
      })),
  );
}

async function revoke(args: string[]) {
  const target = args[0];
  if (!target) {
    console.error('usage: invites revoke <label|hash-prefix>');
    process.exit(1);
  }

  const db = getDb();
  const now = new Date();

  // By label first — that's what the operator actually remembers.
  const byLabel = await db
    .update(schema.invites)
    .set({ revokedAt: now })
    .where(eq(schema.invites.label, target))
    .returning();

  if (byLabel.length > 0) {
    console.log(`Revoked ${byLabel.length} invite(s) labelled "${target}".`);
    return;
  }

  const byHash = await db
    .update(schema.invites)
    .set({ revokedAt: now })
    .where(like(schema.invites.tokenHash, `${target}%`))
    .returning();

  console.log(
    byHash.length > 0
      ? `Revoked ${byHash.length} invite(s) matching id "${target}".`
      : `No invite matched "${target}".`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

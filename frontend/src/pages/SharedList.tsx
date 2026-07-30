import { Link, useParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { SavedTitleRow, filmAsEvent } from '../components/SavedTitleRow';
import { SkeletonList } from '../components/states';

/**
 * Someone else's "want to go" list, opened from a share link (GOI-47).
 *
 * Public: no session, no account, nothing but the token in the URL. It shows
 * the same rows the owner sees on /my, minus their actions and minus anything
 * they've marked seen — so "Nearest screenings" works here too and the link is
 * useful rather than just a list of names.
 *
 * The page never says whose list it is. We only hold an email address, and a
 * link forwarded past its intended recipient shouldn't hand that out.
 */
export function SharedListPage() {
  const { token = '' } = useParams<{ token: string }>();
  const list = trpc.sharedList.get.useQuery({ token }, { retry: false, enabled: token.length > 0 });

  const rows = [
    ...(list.data?.entries ?? []).map((entry) => ({
      key: `event-${entry.event.id}`,
      sortKey: entry.savedAt,
      event: entry.event,
    })),
    ...(list.data?.films ?? []).map((film) => ({
      key: `film-${film.id}`,
      sortKey: film.createdAt,
      event: filmAsEvent(film),
    })),
  ].sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  return (
    <section>
      <h1 className="mb-2 font-serif text-3xl tracking-tight">Want to go</h1>
      <p className="mb-6 text-sm text-muted max-w-prose">
        A shared list. Open &ldquo;Nearest screenings&rdquo; on anything here to see where
        and when it&rsquo;s on.
      </p>

      {list.isLoading ? <SkeletonList rows={3} /> : null}

      {list.error ? (
        <div>
          <p role="alert" className="text-sm text-muted">
            This list isn&rsquo;t shared any more, or the link is wrong.
          </p>
          <p className="mt-4 text-sm">
            <Link to="/" className="link-accent no-underline">
              Browse what&rsquo;s on instead
            </Link>
          </p>
        </div>
      ) : null}

      {list.data && rows.length === 0 ? (
        <p className="text-sm text-muted">This list is empty for now.</p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="divide-y divide-rule border-y border-rule list-none m-0 p-0">
          {rows.map((row) => (
            <li key={row.key} className="py-3">
              <SavedTitleRow event={row.event} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
